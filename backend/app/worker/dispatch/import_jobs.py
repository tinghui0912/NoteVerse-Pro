from __future__ import annotations

from uuid import uuid4

from opentelemetry.trace import SpanKind

from app.core.background_tracing import background_attempt_span, record_current_attempt_failure
from app.core.logger import logger
from app.db.sync_session import get_worker_db
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.worker.celery_config import celery_app
from app.worker.dispatch.tracing import import_trace_context


def dispatch_import_job(job_uuid: str) -> bool:
    task_id = uuid4().hex
    try:
        with get_worker_db() as db:
            trace_context = import_trace_context(db, job_uuid)
        with background_attempt_span(
            name="noteverse.import.dispatch",
            traceparent=trace_context.traceparent,
            tracestate=trace_context.tracestate,
            kind=SpanKind.PRODUCER,
            attributes={"noteverse.operation.kind": "import", "noteverse.operation.id": job_uuid},
        ):
            try:
                celery_app.send_task(
                    "app.worker.tasks.process_images_job",
                    kwargs={"job_uuid": job_uuid},
                    task_id=task_id,
                )
            except Exception as exc:
                record_current_attempt_failure(exc)
                with get_worker_db() as db:
                    import_dispatch_service.release_dispatch(db, job_uuid, str(exc))
                logger.bind(
                    event="import.dispatch_failed",
                    operation_kind="import",
                    job_id=job_uuid,
                    task_id=task_id,
                    exception_type=type(exc).__name__,
                ).warning("import.dispatch_failed")
                return False
            logger.bind(
                event="import.dispatched",
                operation_kind="import",
                job_id=job_uuid,
                task_id=task_id,
            ).info("import.dispatched")
            return True
    except Exception as exc:
        with get_worker_db() as db:
            import_dispatch_service.release_dispatch(db, job_uuid, str(exc))
        logger.bind(
            event="import.dispatch_failed",
            operation_kind="import",
            job_id=job_uuid,
            task_id=task_id,
            exception_type=type(exc).__name__,
        ).opt(exception=True).warning("import.dispatch_failed")
        return False
