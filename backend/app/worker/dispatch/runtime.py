"""Shared runtime helper for durable Celery task producers."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from opentelemetry.trace import SpanKind

from app.core.background_tracing import background_attempt_span, record_current_attempt_failure
from app.core.logger import logger
from app.worker.celery_config import celery_app
from app.worker.dispatch.tracing import DurableTraceContext


def send_durable_task(
    *,
    task_name: str,
    task_kwargs: dict[str, str],
    task_id: str,
    operation_kind: str,
    operation_id: str,
    span_name: str,
    success_event: str,
    failure_event: str,
    log_context: dict[str, object],
    trace_context: DurableTraceContext,
    release_dispatch: Callable[[str], None],
) -> bool:
    """Publish a durable task relay and release its DB dispatch state on failure."""

    try:
        with background_attempt_span(
            name=span_name,
            traceparent=trace_context.traceparent,
            tracestate=trace_context.tracestate,
            kind=SpanKind.PRODUCER,
            attributes={
                "noteverse.operation.kind": operation_kind,
                "noteverse.operation.id": operation_id,
            },
        ):
            try:
                celery_app.send_task(
                    task_name,
                    kwargs=task_kwargs,
                    task_id=task_id,
                )
            except Exception as exc:
                record_current_attempt_failure(exc)
                release_dispatch(str(exc))
                _dispatch_logger(
                    failure_event,
                    operation_kind=operation_kind,
                    task_id=task_id,
                    log_context=log_context,
                    exception_type=type(exc).__name__,
                ).warning(failure_event)
                return False
            _dispatch_logger(
                success_event,
                operation_kind=operation_kind,
                task_id=task_id,
                log_context=log_context,
            ).info(success_event)
            return True
    except Exception as exc:
        release_dispatch(str(exc))
        _dispatch_logger(
            failure_event,
            operation_kind=operation_kind,
            task_id=task_id,
            log_context=log_context,
            exception_type=type(exc).__name__,
        ).opt(exception=True).warning(failure_event)
        return False


def _dispatch_logger(
    event: str,
    *,
    operation_kind: str,
    task_id: str,
    log_context: dict[str, object],
    exception_type: str | None = None,
) -> Any:
    context = {
        "event": event,
        "operation_kind": operation_kind,
        **log_context,
        "task_id": task_id,
    }
    if exception_type is not None:
        context["exception_type"] = exception_type
    return logger.bind(**context)
