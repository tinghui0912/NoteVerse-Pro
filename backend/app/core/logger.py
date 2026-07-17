"""Central logging setup for the backend.

This module configures loguru for both local development and production-style
JSON logging. It also provides trace/task context helpers and a basic
sensitive-data filter for common secret fields.
"""

import json
import re
import sys
import traceback
import uuid
from contextvars import ContextVar
from typing import Optional

from loguru import logger as _logger

from app.core.config import settings

_logger.remove()

log_format = settings.LOG_FORMAT


trace_id_var: ContextVar[Optional[str]] = ContextVar("trace_id", default=None)
task_id_var: ContextVar[Optional[str]] = ContextVar("task_id", default=None)


def get_trace_id() -> Optional[str]:
    """Return the current request trace ID."""

    return trace_id_var.get()


def set_trace_id(trace_id: Optional[str] = None) -> str:
    """Set the current request trace ID and return the resolved value."""

    if trace_id is None:
        trace_id = str(uuid.uuid4())[:8]
    trace_id_var.set(trace_id)
    return trace_id


def get_task_id() -> Optional[str]:
    """Return the current background-task identifier."""

    return task_id_var.get()


def set_task_id(task_id: Optional[str]) -> None:
    """Set the current background-task identifier."""

    task_id_var.set(task_id)


class SensitiveDataFilter:
    """Mask common secret fields before they reach logs."""

    SENSITIVE_FIELDS = {
        "password",
        "password_hash",
        "hashed_password",
        "secret_key",
        "token",
        "access_token",
        "refresh_token",
        "api_key",
        "private_key",
        "secret",
        "mail_password",
        "celery_broker_url",
    }

    PATTERNS = [
        (re.compile(r'password["\']?\s*[:=]\s*["\']?([^"\'\s,}]+)', re.I), "password"),
        (re.compile(r'token["\']?\s*[:=]\s*["\']?([^"\'\s,}]+)', re.I), "token"),
        (re.compile(r'key["\']?\s*[:=]\s*["\']?([^"\'\s,}]+)', re.I), "key"),
    ]

    @classmethod
    def filter_dict(cls, data: dict[str, object]) -> dict[str, object]:
        """Return a copy of a dict with secret values redacted."""

        if not isinstance(data, dict):
            return data

        filtered: dict[str, object] = {}
        for key, value in data.items():
            if key.lower() in cls.SENSITIVE_FIELDS:
                filtered[key] = "***FILTERED***"
            elif isinstance(value, dict):
                filtered[key] = cls.filter_dict(value)
            elif isinstance(value, list):
                filtered[key] = [
                    cls.filter_dict(item) if isinstance(item, dict) else item
                    for item in value
                ]
            else:
                filtered[key] = value
        return filtered

    @classmethod
    def filter_string(cls, text: str) -> str:
        """Redact secret-like fragments inside a plain string."""

        for pattern, field_type in cls.PATTERNS:
            text = pattern.sub(f"{field_type}=***FILTERED***", text)
        return text


def filtered_format(record):
    """Apply string-level secret filtering to each record message."""

    if "message" in record:
        record["message"] = SensitiveDataFilter.filter_string(str(record["message"]))
    return True


def console_format(record):
    """Return the colored console formatter for local development."""

    trace_id = get_trace_id()
    task_id = get_task_id()

    extra = ""
    if trace_id:
        extra += f"[{trace_id}] "
    if task_id:
        extra += f"task={task_id[:8]} "

    return (
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
        "<level>{level: <8}</level> | "
        f"{extra}"
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
        "<level>{message}</level>\n{exception}"
    )


def json_format(record) -> str:
    """Serialize a loguru record as newline-delimited JSON."""

    trace_id = get_trace_id()
    task_id = get_task_id()

    log_record = {
        "timestamp": record["time"].strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "level": record["level"].name,
        "logger": record["name"],
        "message": SensitiveDataFilter.filter_string(str(record["message"])),
        "function": record["function"],
        "line": record["line"],
    }

    reserved_keys = set(log_record)
    extra = SensitiveDataFilter.filter_dict(dict(record["extra"]))
    for key, value in extra.items():
        output_key = key if key not in reserved_keys else f"extra_{key}"
        log_record[output_key] = value

    if trace_id:
        log_record["trace_id"] = trace_id
    if task_id:
        log_record["task_id"] = task_id

    if record["exception"]:
        log_record["exception"] = {
            "type": record["exception"].type.__name__
            if record["exception"].type
            else None,
            "value": str(record["exception"].value)
            if record["exception"].value
            else None,
            "traceback": "".join(
                traceback.format_exception(
                    record["exception"].type,
                    record["exception"].value,
                    record["exception"].traceback,
                )
            ),
        }

    return json.dumps(log_record, ensure_ascii=False, default=str) + "\n"


def json_sink(message):
    """Write JSON logs to stdout with encoding fallback for Windows consoles."""

    payload = json_format(message.record)
    try:
        sys.stdout.write(payload)
    except UnicodeEncodeError:
        encoding = sys.stdout.encoding or "utf-8"
        safe_payload = payload.encode(encoding, errors="replace").decode(
            encoding,
            errors="replace",
        )
        sys.stdout.write(safe_payload)


if log_format == "console":
    _logger.add(
        sys.stdout,
        colorize=True,
        format=console_format,
        level="DEBUG",
        filter=filtered_format,
    )
else:
    _logger.add(json_sink, level="INFO", filter=filtered_format)

logger = _logger

__all__ = [
    "logger",
    "SensitiveDataFilter",
    "get_trace_id",
    "set_trace_id",
    "get_task_id",
    "set_task_id",
    "trace_id_var",
    "task_id_var",
]
