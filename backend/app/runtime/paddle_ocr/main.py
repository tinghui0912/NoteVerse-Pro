"""JSON protocol and process environment for a single OCR execution."""

import json
import os
import sys
from contextlib import redirect_stdout
from app.processing.engines.ocr.paddle_execution import recognize_image
from app.runtime.paddle_ocr.settings import PaddleOcrSettings


def _set_stable_env() -> None:
    """Set conservative environment defaults for Paddle-based OCR."""
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    os.environ.setdefault("FLAGS_use_mkldnn", "false")


def main(argv: list[str]) -> int:
    """Run PaddleOCR on the given image path and print JSON to stdout."""
    if len(argv) != 2:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": "image_path argument is required",
                    "code": "invalid_args",
                }
            )
        )
        return 1

    image_path = argv[1]
    if not os.path.exists(image_path):
        print(
            json.dumps(
                {
                    "success": False,
                    "error": f"Image file does not exist: {image_path}",
                    "code": "file_not_found",
                }
            )
        )
        return 1

    _set_stable_env()

    try:
        with redirect_stdout(sys.stderr):
            result = recognize_image(image_path, config=PaddleOcrSettings())
        print(json.dumps({"success": True, "result": result}, ensure_ascii=False))
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
