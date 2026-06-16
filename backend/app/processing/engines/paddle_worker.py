"""Standalone PaddleOCR worker module executed in a subprocess."""

from __future__ import annotations

import json
import os
import inspect
import sys
from typing import Any


def _set_stable_env() -> None:
    """Set conservative environment defaults for Paddle-based OCR."""
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    os.environ.setdefault("FLAGS_use_mkldnn", "false")


def _existing_env_path(name: str) -> str | None:
    """Return an expanded env path only when the variable is configured."""

    value = os.environ.get(name)
    if not value:
        return None
    return os.path.abspath(os.path.expanduser(value))


def _set_first_supported_path(
    kwargs: dict[str, Any],
    parameters: dict[str, Any],
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
        parameters = inspect.signature(paddle_ocr_cls).parameters
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

    _set_first_supported_path(
        kwargs,
        parameters,
        ("text_detection_model_dir", "det_model_dir"),
        _existing_env_path("PADDLEOCR_DETECTION_MODEL_DIR"),
    )
    _set_first_supported_path(
        kwargs,
        parameters,
        ("text_recognition_model_dir", "rec_model_dir"),
        _existing_env_path("PADDLEOCR_RECOGNITION_MODEL_DIR"),
    )
    _set_first_supported_path(
        kwargs,
        parameters,
        (
            "textline_orientation_model_dir",
            "text_line_orientation_model_dir",
            "cls_model_dir",
        ),
        _existing_env_path("PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR"),
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
