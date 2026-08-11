from __future__ import annotations

from uuid import uuid4

from app.core.logger import logger
from app.db.sync_session import get_worker_db
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.worker.dispatch.runtime import send_durable_task
from app.worker.dispatch.tracing import import_trace_context


def dispatch_import_job(job_uuid: str) -> bool:
    task_id = uuid4().hex
    try:
        with get_worker_db() as db:
            trace_context = import_trace_context(db, job_uuid)
        return send_durable_task(
            task_name="app.worker.tasks.process_images_job",
            task_kwargs={"job_uuid": job_uuid},
            task_id=task_id,
            operation_kind="import",
            operation_id=job_uuid,
            span_name="noteverse.import.dispatch",
            success_event="import.dispatched",
            failure_event="import.dispatch_failed",
            log_context={"job_id": job_uuid},
            trace_context=trace_context,
            release_dispatch=lambda error: _release_dispatch(job_uuid, error),
        )
    except Exception as exc:
        _release_dispatch(job_uuid, str(exc))
        logger.bind(
            event="import.dispatch_failed",
            operation_kind="import",
            job_id=job_uuid,
            task_id=task_id,
            exception_type=type(exc).__name__,
        ).opt(exception=True).warning("import.dispatch_failed")
        return False


def _release_dispatch(job_uuid: str, error: str) -> None:
    with get_worker_db() as db:
        import_dispatch_service.release_dispatch(db, job_uuid, error)
