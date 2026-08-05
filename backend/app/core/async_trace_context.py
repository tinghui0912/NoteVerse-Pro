"""Durable W3C context captured when asynchronous work is created.

This module deliberately has no OpenTelemetry dependency so database services,
Celery Beat, and worker images can carry the context without importing an HTTP
instrumentation runtime. Instrumented runtimes set this value at their boundary.
"""

from contextvars import ContextVar
import re


_traceparent_var: ContextVar[str | None] = ContextVar("async_traceparent", default=None)
_tracestate_var: ContextVar[str | None] = ContextVar("async_tracestate", default=None)

_TRACEPARENT_PATTERN = re.compile(
    r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$"
)
_ZERO_TRACE_ID = "0" * 32
_ZERO_SPAN_ID = "0" * 16
_MAX_TRACESTATE_LENGTH = 512


def normalize_async_trace_context(
    *, traceparent: str | None, tracestate: str | None
) -> tuple[str | None, str | None]:
    """Return a safe, supported W3C context or an empty context.

    Durable records are a trust boundary: malformed propagation data must not
    turn an otherwise valid business operation into an error or be replayed by
    a background worker.  NoteVerse currently emits version 00 traceparents.
    """

    if traceparent is None:
        return None, None

    match = _TRACEPARENT_PATTERN.fullmatch(traceparent)
    if match is None or match.group(1) == _ZERO_TRACE_ID or match.group(2) == _ZERO_SPAN_ID:
        return None, None

    if (
        tracestate is not None
        and (len(tracestate) > _MAX_TRACESTATE_LENGTH or any(ord(char) < 0x20 for char in tracestate))
    ):
        tracestate = None

    return traceparent, tracestate


def set_async_trace_context(*, traceparent: str | None, tracestate: str | None = None) -> None:
    """Set the vetted message-creation context for the current execution."""

    normalized_traceparent, normalized_tracestate = normalize_async_trace_context(
        traceparent=traceparent,
        tracestate=tracestate,
    )
    _traceparent_var.set(normalized_traceparent)
    _tracestate_var.set(normalized_tracestate)


def get_async_trace_context() -> tuple[str | None, str | None]:
    """Return durable W3C fields for a newly-created asynchronous record."""

    return _traceparent_var.get(), _tracestate_var.get()
