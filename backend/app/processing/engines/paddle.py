"""Subprocess-backed PaddleOCR execution helpers."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Literal, TypedDict

from app.core.config import settings
from app.core.logger import logger

_CREATE_NO_WINDOW = int(getattr(subprocess, "CREATE_NO_WINDOW", 0))

_BACKEND_DIR = Path(__file__).resolve().parents[3]
_WORKER_MODULE = "app.processing.engines.paddle_worker"
_PADDLEOCR_ENV_NAMES = (
    "PADDLEOCR_ALLOW_MODEL_DOWNLOAD",
    "PADDLEOCR_MODEL_ROOT",
    "PADDLEOCR_DETECTION_MODEL_DIR",
    "PADDLEOCR_RECOGNITION_MODEL_DIR",
    "PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR",
)


class PaddleOcrSuccessResult(TypedDict):
    """Successful PaddleOCR subprocess result."""

    success: Literal[True]
    result: list[Any]


class PaddleOcrFailureResult(TypedDict):
    """Failed PaddleOCR subprocess result."""

    success: Literal[False]
    error: str
    code: str


PaddleOcrResult = PaddleOcrSuccessResult | PaddleOcrFailureResult


def _output_tail(value: str, max_length: int = 1000) -> str:
    """Return a compact tail of subprocess output for diagnostics."""

    compact = value.strip()
    if len(compact) <= max_length:
        return compact
    return compact[-max_length:]


def _load_json_payload(stdout: str) -> dict[str, Any] | None:
    """Load the structured worker payload, tolerating third-party stdout noise."""

    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        payload = None
    if isinstance(payload, dict):
        return payload

    for line in reversed(stdout.splitlines()):
        candidate = line.strip()
        if not candidate or not candidate.startswith("{"):
            continue
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return None


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
    env = os.environ.copy()
    for name in _PADDLEOCR_ENV_NAMES:
        value = getattr(settings, name, None)
        if value:
            env[name] = str(value)

    try:
        logger.bind(
            event="paddle_ocr.subprocess_started",
            image_path=os.path.abspath(image_path),
            timeout_seconds=timeout_seconds,
            worker_module=_WORKER_MODULE,
        ).info("PaddleOCR subprocess started")
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            cwd=str(_BACKEND_DIR),
            env=env,
            creationflags=_CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired as exc:
        logger.bind(
            event="paddle_ocr.subprocess_timeout",
            image_path=os.path.abspath(image_path),
            timeout_seconds=timeout_seconds,
        ).opt(exception=exc).warning("PaddleOCR subprocess timed out")
        return {
            "success": False,
            "error": "PaddleOCR processing timed out",
            "code": "task_timeout",
        }
    except Exception as exc:
        logger.bind(
            event="paddle_ocr.subprocess_launch_failed",
            image_path=os.path.abspath(image_path),
            exception_type=type(exc).__name__,
        ).opt(exception=exc).error("PaddleOCR subprocess launch failed")
        return {
            "success": False,
            "error": f"PaddleOCR subprocess launch failed: {exc}",
            "code": "ocr_subprocess_failed",
        }

    if result.returncode != 0:
        payload = _load_json_payload(result.stdout)

        if payload is not None:
            error_detail = str(payload.get("error") or result.stderr.strip() or "Unknown PaddleOCR error")
            error_code = str(payload.get("code") or "ocr_subprocess_failed")
        else:
            error_detail = result.stderr.strip() or result.stdout.strip() or "Unknown PaddleOCR error"
            error_code = "ocr_subprocess_failed"

        logger.bind(
            event="paddle_ocr.subprocess_failed",
            image_path=os.path.abspath(image_path),
            exit_code=result.returncode,
            error_code=error_code,
            stderr_tail=_output_tail(result.stderr),
            stdout_tail=_output_tail(result.stdout),
            internal_reason=error_detail,
        ).warning("PaddleOCR subprocess failed")
        return {
            "success": False,
            "error": error_detail,
            "code": error_code,
        }

    payload = _load_json_payload(result.stdout)
    if payload is None:
        logger.bind(
            event="paddle_ocr.invalid_output",
            image_path=os.path.abspath(image_path),
            stdout_tail=_output_tail(result.stdout),
            stderr_tail=_output_tail(result.stderr),
        ).error("PaddleOCR subprocess returned invalid output")
        return {
            "success": False,
            "error": "PaddleOCR subprocess returned invalid JSON",
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
