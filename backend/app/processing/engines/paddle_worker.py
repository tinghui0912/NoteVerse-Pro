"""Standalone PaddleOCR worker module executed in a subprocess."""

from __future__ import annotations

import json
import os
import sys
from typing import Any


def _set_stable_env() -> None:
    """Set conservative environment defaults for Paddle-based OCR."""
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    os.environ.setdefault("FLAGS_use_mkldnn", "false")


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

        ocr = PaddleOCR(
            use_textline_orientation=True,
            lang="ch",
            use_gpu=True,
        )
        result = ocr.ocr(image_path)
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
