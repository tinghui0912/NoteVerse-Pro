"""Subprocess-backed PaddleOCR execution helpers."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, TypedDict

from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parents[3]
_WORKER_MODULE = "app.processing.engines.paddle_worker"


class PaddleOcrSuccessResult(TypedDict):
    """Successful PaddleOCR subprocess result."""

    success: bool
    result: list[Any]


class PaddleOcrFailureResult(TypedDict):
    """Failed PaddleOCR subprocess result."""

    success: bool
    error: str
    code: str


PaddleOcrResult = PaddleOcrSuccessResult | PaddleOcrFailureResult


def run_ocr_subprocess(
    image_path: str,
    timeout_seconds: int | None = None,
) -> PaddleOcrResult:
    """Run PaddleOCR in an isolated subprocess and return a JSON-safe result."""
    if not os.path.exists(image_path):
        return {
            "success": False,
            "error": f"Image file does not exist: {image_path}",
            "code": "file_not_found",
        }

    cmd = [
        sys.executable,
        "-m",
        _WORKER_MODULE,
        os.path.abspath(image_path),
    ]

    try:
        logger.info(f"Executing PaddleOCR subprocess: {' '.join(cmd)}")
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            cwd=str(_BACKEND_DIR),
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired:
        logger.error("PaddleOCR subprocess timed out")
        return {
            "success": False,
            "error": "PaddleOCR processing timed out",
            "code": "task_timeout",
        }
    except Exception as exc:
        logger.error(f"PaddleOCR subprocess launch failed: {exc}")
        return {
            "success": False,
            "error": f"PaddleOCR subprocess launch failed: {exc}",
            "code": "ocr_subprocess_failed",
        }

    if result.returncode != 0:
        error_detail = result.stderr.strip() or result.stdout.strip() or "Unknown PaddleOCR error"
        logger.error(f"PaddleOCR subprocess failed: {error_detail}")
        return {
            "success": False,
            "error": error_detail,
            "code": "ocr_subprocess_failed",
        }

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        logger.error(f"PaddleOCR subprocess returned invalid JSON: {exc}")
        return {
            "success": False,
            "error": "PaddleOCR subprocess returned invalid JSON",
            "code": "ocr_invalid_output",
        }

    if not isinstance(payload, dict):
        return {
            "success": False,
            "error": "PaddleOCR subprocess returned an unexpected payload",
            "code": "ocr_invalid_output",
        }

    success = bool(payload.get("success"))
    if not success:
        return {
            "success": False,
            "error": str(payload.get("error") or "PaddleOCR processing failed"),
            "code": str(payload.get("code") or "ocr_failed"),
        }

    ocr_result = payload.get("result")
    if not isinstance(ocr_result, list):
        return {
            "success": False,
            "error": "PaddleOCR subprocess returned an invalid OCR result",
            "code": "ocr_invalid_output",
        }

    return {"success": True, "result": ocr_result}
