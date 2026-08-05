"""Central logging setup for the backend.

This module configures loguru for both local development and production-style
JSON logging. It also provides trace/task context helpers and a basic
sensitive-data filter for common secret fields.
"""

import json
import re
import sys
import uuid
from contextvars import ContextVar
from typing import Optional

from loguru import logger as _logger

from app.core.config import settings

_logger.remove()

log_format = settings.LOG_FORMAT


request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
task_id_var: ContextVar[Optional[str]] = ContextVar("task_id", default=None)
otel_trace_context_var: ContextVar[dict[str, str]] = ContextVar(
    "otel_trace_context",
    default={},
)
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


def set_otel_trace_context(context: dict[str, str] | None = None) -> None:
    """Store a validated W3C trace context captured by an HTTP runtime."""

    otel_trace_context_var.set(dict(context or {}))


def get_otel_trace_context() -> dict[str, str]:
    """Return the trace context captured by an instrumented HTTP runtime."""

    return otel_trace_context_var.get()


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


class StructuredLogFieldPolicy:
    """Allow only reviewed structured fields in production log records.

    Application logs are exported outside the process.  Treat every bound
    value as untrusted unless it is deliberately classified here.  This is a
    stricter boundary than keyword redaction: unknown fields are omitted.
    """

    ALLOWED_EXTRA_FIELDS = frozenset(
        {
            "accepted", "active_streak", "alignment_confidence", "alignment_state",
            "api_docs_path", "app_version", "armed", "attempt", "attempts",
            "audio_confidence", "beat", "beat_delta", "beat_velocity", "blob_id",
            "category", "client_address", "completed", "confidence",
            "continuity_confidence", "continuity_state", "corrected_length", "count",
            "current_step", "decision", "device", "due", "duration_ms",
            "duration_seconds", "effective_start_peak_gate", "effective_start_rms_gate",
            "engine", "enhanced", "environment", "error_code", "event", "event_type",
            "exception_type", "exit_code", "feature_confidence", "first_measure_number",
            "fixes_made", "flux_gate", "frame", "frame_class", "frames", "gate_reason",
            "hand_size", "head_revision_id", "http_path", "input_policy_confidence",
            "input_weight", "job_id", "margin", "match_state", "max_attempts",
            "measure_count", "method", "no_input_streak", "noise_samples",
            "notification_type", "onset", "operation_kind", "originating_request_id",
            "original_length",
            "outbox_id", "page_count", "page_height", "page_index", "page_width",
            "payload_shape", "payload_type", "peak", "peak_gate", "peak_prominence",
            "peer_address", "performance_active", "pipeline", "progress", "project_name",
            "public_code", "queue_decision", "raw_beat", "reason", "recipient_user_id",
            "region_count", "rejected", "request_id", "resource_id", "resource_type",
            "retain_recent_revisions", "revision_id", "rms", "rms_gate", "row_count",
            "row_index", "runtime_reason", "runtime_role", "scheduler_job", "score_id",
            "session_id", "spectral_flatness", "spectral_flux", "start_feature_confidence",
            "start_peak_gate", "start_reason", "start_rms_gate", "start_streak", "started",
            "state", "status", "status_code", "status_label", "step", "task_id",
            "text_count", "text_index", "text_length", "timeout_seconds", "tonal",
            "upload_count", "upload_id", "user_id", "validation_confidence",
            "validation_error_count", "validation_first_location", "validation_first_type",
            "worker_module",
        }
    )
    FORBIDDEN_EXTRA_FIELDS = frozenset(
        {
            "destination_path", "filename", "image_path", "internal_reason", "musicxml_path",
            "output_path", "path", "source_path", "stderr_tail", "stdout_tail",
            "storage_key", "stem", "text_summary",
        }
    )

    @classmethod
    def filter_extra(cls, data: dict[str, object]) -> dict[str, object]:
        """Return reviewed fields only; silently omit forbidden/unknown values."""

        return {key: value for key, value in data.items() if key in cls.ALLOWED_EXTRA_FIELDS}


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

    extra = StructuredLogFieldPolicy.filter_extra(
        SensitiveDataFilter.filter_dict(dict(record["extra"]))
    )
    explicit_request_id = extra.pop("request_id", None)
    # These names are reserved for their respective context mechanisms. A
    # call site must not be able to create a second, incompatible trace field.
    extra.pop("trace_id", None)
    extra.pop("span_id", None)
    reserved_keys = set(log_record)
    for key, value in extra.items():
        output_key = key if key not in reserved_keys else f"extra_{key}"
        log_record[output_key] = value

    if request_id or isinstance(explicit_request_id, str):
        log_record["request_id"] = request_id or explicit_request_id
    log_record.update(get_otel_trace_context())
    if task_id:
        log_record["task_id"] = task_id

    if record["exception"]:
        log_record.setdefault(
            "exception_type",
            record["exception"].type.__name__ if record["exception"].type else None,
        )

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
    "StructuredLogFieldPolicy",
    "get_request_id",
    "set_request_id",
    "get_otel_trace_context",
    "set_otel_trace_context",
    "get_task_id",
    "set_task_id",
    "request_id_var",
    "task_id_var",
    "otel_trace_context_var",
]
