"""Celery task entrypoints for image-processing jobs."""

from typing import List, Optional

from celery.utils.log import get_task_logger

from app.db.worker_session import get_worker_db
from app.modules.jobs.execution_service import job_execution_service
from app.modules.jobs.maintenance_service import job_maintenance_service
from app.modules.jobs.schemas import JobProcessingOptions, PipelineExecutionSuccessResult
from app.pipeline.context import CeleryTaskLike
from app.utils.email import send_email
from app.worker.celery_config import celery_app

logger = get_task_logger(__name__)


@celery_app.task(
    bind=True,
    name="app.worker.tasks.process_images_job",
    acks_late=True,
    reject_on_worker_lost=True,
)
def process_images_job(
    self: CeleryTaskLike,
    upload_ids: List[str],
    options: Optional[JobProcessingOptions] = None,
) -> PipelineExecutionSuccessResult:
    """Run the image-processing pipeline for one or more input images."""

    return job_execution_service.run_pipeline(self, upload_ids, options)


@celery_app.task(
    bind=True,
    name="app.worker.tasks.send_email_task",
    autoretry_for=(RuntimeError,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
)
def send_email_task(
    self,
    to_email: str,
    subject: str,
    body: str,
) -> dict[str, str]:
    """Send an email in the background via the configured SMTP provider."""

    send_email(to_email=to_email, subject=subject, body=body)
    logger.info(f"Email sent to {to_email}")
    return {"status": "sent", "to_email": to_email}


@celery_app.task(name="app.worker.tasks.run_job_maintenance")
def run_job_maintenance() -> dict[str, int]:
    """Run periodic processing-job/upload maintenance."""

    with get_worker_db() as db:
        result = job_maintenance_service.run(db)

    return {
        "stale_pending_failed": result.stale_pending_failed,
        "stale_progress_failed": result.stale_progress_failed,
        "orphan_uploads_deleted": result.orphan_uploads_deleted,
    }
