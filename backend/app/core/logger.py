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
from opentelemetry import trace

from app.core.config import settings

_logger.remove()

log_format = settings.LOG_FORMAT


request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
task_id_var: ContextVar[Optional[str]] = ContextVar("task_id", default=None)
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def get_request_id() -> Optional[str]:
    """Return the current request correlation identifier."""

    return request_id_var.get()


def set_request_id(request_id: Optional[str] = None) -> str:
    """Set the current request correlation identifier and return it."""

    if request_id is None or not REQUEST_ID_PATTERN.fullmatch(request_id):
        request_id = uuid.uuid4().hex
    request_id_var.set(request_id)
    return request_id


def get_otel_trace_context() -> dict[str, str]:
    """Return the active W3C trace context when instrumentation created a span."""

    context = trace.get_current_span().get_span_context()
    if not context.is_valid:
        return {}
    return {
        "trace_id": f"{context.trace_id:032x}",
        "span_id": f"{context.span_id:016x}",
    }


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

    request_id = get_request_id()
    task_id = get_task_id()

    extra = ""
    if request_id:
        extra += f"request={request_id[:8]} "
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

    request_id = get_request_id()
    task_id = get_task_id()

    log_record = {
        "timestamp": record["time"].strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "level": record["level"].name,
        "logger": record["name"],
        "message": SensitiveDataFilter.filter_string(str(record["message"])),
        "function": record["function"],
        "line": record["line"],
        "schema_version": 1,
    }

    reserved_keys = set(log_record) | {"request_id", "trace_id", "span_id"}
    extra = SensitiveDataFilter.filter_dict(dict(record["extra"]))
    for key, value in extra.items():
        output_key = key if key not in reserved_keys else f"extra_{key}"
        log_record[output_key] = value

    if request_id:
        log_record["request_id"] = request_id
    log_record.update(get_otel_trace_context())
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
    "get_request_id",
    "set_request_id",
    "get_otel_trace_context",
    "get_task_id",
    "set_task_id",
    "request_id_var",
    "task_id_var",
]
