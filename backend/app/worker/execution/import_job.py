"""Execution handler for import-job Celery tasks."""

from __future__ import annotations


import sys
from app.platform.config.application import ImportExecutionConfig

from app.modules.import_jobs.lifecycle import IMPORT_EXECUTION_CLOSED_STATES
from app.modules.import_jobs.dispatch_service import (
    require_current_attempt,
    StaleImportDispatchAttempt,
)
from app.task_queue.protocols import CeleryTaskLike
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    operation_logger,
    start_attempt_trace,
)
from app.runtime.worker.context import get_context


def execute_import_dispatch_task(
    task: CeleryTaskLike,
    dispatch_uuid: str,
) -> dict[str, object]:
    """Run the score import pipeline for one or more input images."""

    bind_task_context(task)
    trace_scope = None
    try:
        with get_context().sessions() as db:
            payload = get_context().deliveries.imports.claim(db, dispatch_uuid)
            db.commit()
        if payload is None:
            operation_logger(
                "import.ignored",
                operation_kind="import",
                operation_id=dispatch_uuid,
                status="ignored",
            ).info("import.ignored")
            return {"status": "ignored", "dispatch_id": dispatch_uuid}

        trace_scope = start_attempt_trace(
            name="noteverse.import.process",
            operation_kind="import",
            operation_id=dispatch_uuid,
            attempt=payload.attempt,
            traceparent=payload.traceparent,
            tracestate=payload.tracestate,
        )
        trace_scope.__enter__()

        context = {
            "operation_kind": "import",
            "job_id": payload.job_uuid,
            "operation_id": dispatch_uuid,
            "attempt": payload.attempt,
            "max_attempts": payload.max_attempts,
            "originating_request_id": payload.originating_request_id,
        }
        operation_logger(
            "import.started",
            **context,
            upload_count=len(payload.inputs),
        ).info("import.started")
        try:
            result = (
                get_context()
                .resources.build_import_pipeline_runner(
                    ImportExecutionConfig.model_validate(get_context().settings.model_dump())
                )
                .run_pipeline(
                    task,
                    payload.lease,
                    payload.inputs,
                )
            )
        except StaleImportDispatchAttempt:
            raise
        except Exception as exc:
            operation_logger(
                "import.failed",
                **context,
                exception_type=type(exc).__name__,
            ).opt(exception=True).error("import.failed")
            with get_context().sessions() as db:
                job = require_current_attempt(db, payload.lease)
                if job.state in IMPORT_EXECUTION_CLOSED_STATES:
                    get_context().deliveries.imports.complete(db, payload.lease)
                db.commit()
            raise

        with get_context().sessions() as db:
            get_context().deliveries.imports.complete(db, payload.lease)
            db.commit()
        operation_logger(
            "import.ready_for_review",
            **context,
            status="completed",
        ).info("import.ready_for_review")
        return dict(result)
    finally:
        if trace_scope is not None:
            trace_scope.__exit__(*sys.exc_info())
        clear_task_context()
