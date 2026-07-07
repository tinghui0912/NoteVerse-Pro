from __future__ import annotations

from app.core.logger import logger
from app.modules.import_jobs.dispatch_service import import_dispatch_service


def dispatch_import_job(job_uuid: str) -> bool:
    try:
        from app.worker.tasks import process_images_job

        process_images_job.apply_async(
            kwargs={"job_uuid": job_uuid},
            task_id=job_uuid,
        )
        return True
    except Exception as exc:
        from app.db.worker_session import get_worker_db

        with get_worker_db() as db:
            import_dispatch_service.release_dispatch(db, job_uuid, str(exc))
        logger.warning("Failed to dispatch import job {}: {}", job_uuid, exc)
        return False
