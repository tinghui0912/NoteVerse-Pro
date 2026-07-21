"""Standalone PaddleOCR worker module executed in a subprocess."""

from __future__ import annotations

import json
import os
import inspect
import sys
from contextlib import redirect_stdout
from typing import Any, Mapping


def _set_stable_env() -> None:
    """Set conservative environment defaults for Paddle-based OCR."""
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    os.environ.setdefault("FLAGS_use_mkldnn", "false")


def _existing_env_path(name: str) -> str | None:
    """Return a configured model path only when it contains a usable model."""

    value = os.environ.get(name)
    if not value:
        return None
    path = os.path.abspath(os.path.expanduser(value))
    required_files = ("inference.yml", "inference.pdiparams", "inference.json")
    if all(os.path.isfile(os.path.join(path, filename)) for filename in required_files):
        return path
    return None


def _env_model_path(name: str) -> str | None:
    """Return a normalized configured model path without requiring files."""

    value = os.environ.get(name)
    if not value:
        return None
    return os.path.abspath(os.path.expanduser(value))


def _model_name_from_path(path: str | None) -> str | None:
    """Use the configured model directory basename as the Paddle model name."""

    if not path:
        return None
    return os.path.basename(os.path.normpath(path)) or None


def _set_first_supported_value(
    kwargs: dict[str, Any],
    parameters: Mapping[str, Any],
    names: tuple[str, ...],
    value: str | None,
) -> None:
    """Set a constructor value using the first supported parameter name."""

    if not value:
        return
    for name in names:
        if name in parameters:
            kwargs[name] = value
            return


def _set_first_supported_path(
    kwargs: dict[str, Any],
    parameters: Mapping[str, Any],
    names: tuple[str, ...],
    path: str | None,
) -> None:
    """Set a model path using the first constructor parameter supported."""

    if not path:
        return
    for name in names:
        if name in parameters:
            kwargs[name] = path
            return


def _to_json_safe(value: Any) -> Any:
    """Convert nested OCR payloads into JSON-serializable Python values."""
    if hasattr(value, "tolist"):
        return _to_json_safe(value.tolist())
    if isinstance(value, dict):
        return {str(key): _to_json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_json_safe(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _build_paddleocr_kwargs(paddle: Any, paddle_ocr_cls: Any) -> dict[str, Any]:
    """Build PaddleOCR kwargs that work across v2/v3 constructor variants."""

    kwargs: dict[str, Any] = {"lang": "ch"}
    try:
        parameters: Mapping[str, Any] = inspect.signature(paddle_ocr_cls).parameters
    except (TypeError, ValueError):
        parameters = {}

    if "use_textline_orientation" in parameters:
        kwargs["use_textline_orientation"] = True
    elif "use_angle_cls" in parameters:
        kwargs["use_angle_cls"] = True

    for disabled_option in ("use_doc_orientation_classify", "use_doc_unwarping"):
        if disabled_option in parameters:
            kwargs[disabled_option] = False

    use_gpu = False
    try:
        use_gpu = bool(
            hasattr(paddle, "device") and paddle.device.is_compiled_with_cuda()
        )
    except Exception:
        use_gpu = False

    if "device" in parameters:
        kwargs["device"] = "gpu" if use_gpu else "cpu"
    elif "use_gpu" in parameters:
        kwargs["use_gpu"] = use_gpu

    allow_download = os.environ.get("PADDLEOCR_ALLOW_MODEL_DOWNLOAD") == "1"
    detection_configured_dir = _env_model_path("PADDLEOCR_DETECTION_MODEL_DIR")
    recognition_configured_dir = _env_model_path("PADDLEOCR_RECOGNITION_MODEL_DIR")
    orientation_configured_dir = _env_model_path("PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR")
    detection_model_dir = None if allow_download else _existing_env_path("PADDLEOCR_DETECTION_MODEL_DIR")
    recognition_model_dir = None if allow_download else _existing_env_path("PADDLEOCR_RECOGNITION_MODEL_DIR")
    orientation_model_dir = None if allow_download else _existing_env_path("PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR")

    _set_first_supported_value(
        kwargs,
        parameters,
        ("text_detection_model_name",),
        _model_name_from_path(detection_configured_dir),
    )
    _set_first_supported_value(
        kwargs,
        parameters,
        ("text_recognition_model_name",),
        _model_name_from_path(recognition_configured_dir),
    )
    _set_first_supported_value(
        kwargs,
        parameters,
        ("textline_orientation_model_name",),
        _model_name_from_path(orientation_configured_dir),
    )

    _set_first_supported_path(
        kwargs,
        parameters,
        ("text_detection_model_dir", "det_model_dir"),
        detection_model_dir,
    )
    _set_first_supported_path(
        kwargs,
        parameters,
        ("text_recognition_model_dir", "rec_model_dir"),
        recognition_model_dir,
    )
    _set_first_supported_path(
        kwargs,
        parameters,
        (
            "textline_orientation_model_dir",
            "text_line_orientation_model_dir",
            "cls_model_dir",
        ),
        orientation_model_dir,
    )

    return kwargs


def main(argv: list[str]) -> int:
    """Run PaddleOCR on the given image path and print JSON to stdout."""
    if len(argv) != 2:
        print(json.dumps({"success": False, "error": "image_path argument is required", "code": "invalid_args"}))
        return 1

    image_path = argv[1]
    if not os.path.exists(image_path):
        print(json.dumps({"success": False, "error": f"Image file does not exist: {image_path}", "code": "file_not_found"}))
        return 1

    _set_stable_env()

    try:
        with redirect_stdout(sys.stderr):
            try:
                import torch  # noqa: F401
            except ImportError:
                pass

            import paddle
            from paddleocr import PaddleOCR

            try:
                if hasattr(paddle, "device") and paddle.device.is_compiled_with_cuda():
                    paddle.device.set_device("gpu")
            except Exception:
                pass

            ocr = PaddleOCR(**_build_paddleocr_kwargs(paddle, PaddleOCR))
            if hasattr(ocr, "ocr"):
                result = ocr.ocr(image_path)
            else:
                result = ocr.predict(image_path)
        print(json.dumps({"success": True, "result": _to_json_safe(result)}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": str(exc),
                    "code": "ocr_failed",
                },
                ensure_ascii=False,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
