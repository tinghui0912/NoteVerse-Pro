from __future__ import annotations

from app.core.logger import logger
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.worker.celery_config import celery_app


def dispatch_import_job(job_uuid: str) -> bool:
    try:
        celery_app.send_task(
            "app.worker.tasks.process_images_job",
            kwargs={"job_uuid": job_uuid},
            task_id=job_uuid,
        )
        logger.bind(
            event="import.dispatched",
            operation_kind="import",
            job_id=job_uuid,
            task_id=job_uuid,
        ).info("import.dispatched")
        return True
    except Exception as exc:
        from app.db.worker_session import get_worker_db

        with get_worker_db() as db:
            import_dispatch_service.release_dispatch(db, job_uuid, str(exc))
        logger.bind(
            event="import.dispatch_failed",
            operation_kind="import",
            job_id=job_uuid,
            task_id=job_uuid,
            exception_type=type(exc).__name__,
        ).opt(exception=True).warning("import.dispatch_failed")
        return False
