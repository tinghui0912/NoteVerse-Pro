"""Execution handler for import-job Celery tasks."""

from __future__ import annotations

import sys

from app.db.sync_session import get_worker_db
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.modules.import_jobs.execution_service import job_execution_service
from app.modules.import_jobs.schemas import PipelineExecutionSuccessResult
from app.pipeline.context import CeleryTaskLike
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    operation_logger,
    start_attempt_trace,
)


def execute_import_job_task(
    task: CeleryTaskLike,
    job_uuid: str,
) -> PipelineExecutionSuccessResult:
    """Run the score import pipeline for one or more input images."""

    bind_task_context(task)
    trace_scope = None
    try:
        with get_worker_db() as db:
            payload = import_dispatch_service.claim(db, job_uuid)
        if payload is None:
            operation_logger(
                "import.ignored",
                operation_kind="import",
                job_id=job_uuid,
                status="ignored",
            ).info("import.ignored")
            return {"success": True, "job_id": job_uuid}

        trace_scope = start_attempt_trace(
            name="noteverse.import.process",
            operation_kind="import",
            operation_id=job_uuid,
            attempt=payload.attempt,
            traceparent=payload.traceparent,
            tracestate=payload.tracestate,
        )
        trace_scope.__enter__()

        context = {
            "operation_kind": "import",
            "job_id": job_uuid,
            "attempt": payload.attempt,
            "max_attempts": payload.max_attempts,
            "originating_request_id": payload.originating_request_id,
        }
        operation_logger(
            "import.started",
            **context,
            upload_count=len(payload.storage_keys),
        ).info("import.started")
        try:
            result = job_execution_service.run_pipeline(
                task,
                job_uuid,
                payload.storage_keys,
                payload.options,
            )
        except Exception as exc:
            operation_logger(
                "import.failed",
                **context,
                exception_type=type(exc).__name__,
            ).opt(exception=True).error("import.failed")
            with get_worker_db() as db:
                import_dispatch_service.complete(db, job_uuid)
            raise

        with get_worker_db() as db:
            import_dispatch_service.complete(db, job_uuid)
        operation_logger(
            "import.completed",
            **context,
            status="completed",
        ).info("import.completed")
        return result
    finally:
        if trace_scope is not None:
            trace_scope.__exit__(*sys.exc_info())
        clear_task_context()
