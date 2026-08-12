"""Shared runtime helpers for Celery task entrypoints."""

from __future__ import annotations

from collections.abc import Callable
from time import monotonic
from typing import Any

from app.core.background_tracing import (
    background_attempt_span,
    background_root_span,
    set_scheduler_trace_outcome,
)
from app.core.logger import logger, set_task_id
from app.db.sync_session import get_worker_db
from app.modules.scheduler_observability.service import (
    SchedulerRunStats,
    scheduler_observability_service,
)
from app.modules.scheduler_lock.service import scheduler_lock_service
from app.pipeline.context import CeleryTaskLike


def bind_task_context(task: CeleryTaskLike | None) -> None:
    task_id = getattr(getattr(task, "request", None), "id", None)
    set_task_id(task_id)


def clear_task_context() -> None:
    set_task_id(None)


def operation_logger(event: str, **context: object) -> Any:
    return logger.bind(event=event, **context)


def start_attempt_trace(
    *,
    name: str,
    operation_kind: str,
    operation_id: str,
    attempt: int,
    traceparent: str | None,
    tracestate: str | None,
) -> Any:
    return background_attempt_span(
        name=name,
        traceparent=traceparent,
        tracestate=tracestate,
        attributes={
            "noteverse.operation.kind": operation_kind,
            "noteverse.operation.id": operation_id,
            "noteverse.operation.attempt": attempt,
        },
    )


def run_scheduler_scan(job_key: str, callback: Callable[[], dict[str, int]]) -> dict[str, int]:
    started_at = monotonic()
    with scheduler_lock_service.try_acquire(job_key) as acquired:
        if not acquired:
            with get_worker_db() as db:
                scheduler_observability_service.record_lock_skipped(db, job_key)
            operation_logger(
                "scheduler.scan_skipped",
                operation_kind="scheduler",
                scheduler_job=job_key,
                reason="lock_not_acquired",
            ).info("scheduler.scan_skipped")
            return {"due": 0, "dispatched": 0, "lock_skipped": 1}

        with get_worker_db() as db:
            scheduler_observability_service.record_lock_acquired(db, job_key)
        with background_root_span(
            name="noteverse.scheduler.scan",
            attributes={
                "noteverse.operation.kind": "scheduler",
                "noteverse.scheduler.job": job_key,
            },
        ):
            return _run_locked_scheduler_scan(job_key, callback, started_at)


def _run_locked_scheduler_scan(
    job_key: str,
    callback: Callable[[], dict[str, int]],
    started_at: float,
) -> dict[str, int]:
    with get_worker_db() as db:
        scheduler_observability_service.record_started(db, job_key)
    try:
        result = callback()
    except Exception as exc:
        duration_seconds = monotonic() - started_at
        with get_worker_db() as db:
            scheduler_observability_service.record_failure(
                db,
                job_key,
                duration_seconds=duration_seconds,
                error=f"{type(exc).__name__}: {exc}",
            )
        operation_logger(
            "scheduler.scan_failed",
            operation_kind="scheduler",
            scheduler_job=job_key,
            duration_seconds=round(duration_seconds, 3),
            exception_type=type(exc).__name__,
        ).opt(exception=True).error("scheduler.scan_failed")
        raise

    duration_seconds = monotonic() - started_at
    stats = _scheduler_run_stats(result)
    set_scheduler_trace_outcome(
        has_activity=any(value != 0 for value in result.values()),
        due=stats.due,
        dispatched=stats.dispatched,
    )
    with get_worker_db() as db:
        scheduler_observability_service.record_success(
            db,
            job_key,
            duration_seconds=duration_seconds,
            stats=stats,
        )
    operation_logger(
        "scheduler.scan_completed",
        operation_kind="scheduler",
        scheduler_job=job_key,
        duration_seconds=round(duration_seconds, 3),
        due=stats.due,
        dispatched=stats.dispatched,
    ).info("scheduler.scan_completed")
    return result


def _scheduler_run_stats(result: dict[str, int]) -> SchedulerRunStats:
    return SchedulerRunStats(
        due=int(result.get("due", 0)),
        dispatched=int(result.get("dispatched", 0)),
    )
