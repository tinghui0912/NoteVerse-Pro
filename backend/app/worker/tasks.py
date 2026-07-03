"""Celery task entrypoints for score import jobs."""

import asyncio
from typing import List, Optional

from celery.utils.log import get_task_logger

from app.db.session import AsyncSessionLocal
from app.db.worker_session import get_worker_db
from app.modules.artifacts.render_service import RevisionRenderService
from app.modules.import_jobs.execution_service import job_execution_service
from app.modules.import_jobs.maintenance_service import job_maintenance_service
from app.modules.import_jobs.schemas import ImportJobProcessingOptions, PipelineExecutionSuccessResult
from app.modules.notifications.maintenance_service import notification_maintenance_service
from app.modules.review.thumbnail_service import review_thumbnail_service
from app.pipeline.context import CeleryTaskLike
from app.utils.email import MailPermanentError, MailTransientError, send_email
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
    options: Optional[ImportJobProcessingOptions] = None,
) -> PipelineExecutionSuccessResult:
    """Run the score import pipeline for one or more input images."""

    return job_execution_service.run_pipeline(self, upload_ids, options)


@celery_app.task(
    bind=True,
    name="app.worker.tasks.send_email_task",
    autoretry_for=(MailTransientError,),
    ignore_result=True,
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
)
def send_email_task(
    self,
    to_email: str,
    subject: str,
    body: str,
    html_body: str | None = None,
) -> dict[str, str]:
    """Send an email in the background via the configured mail provider."""

    try:
        send_email(to_email=to_email, subject=subject, body=body, html_body=html_body)
    except MailPermanentError as exc:
        logger.error("Email delivery failed permanently for %s: %s", to_email, exc)
        return {"status": "failed", "to_email": to_email}
    logger.info(f"Email sent to {to_email}")
    return {"status": "sent", "to_email": to_email}


@celery_app.task(
    name="app.worker.tasks.render_score_revision_task",
    autoretry_for=(Exception,),
    ignore_result=True,
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 2},
)
def render_score_revision_task(score_id: str, revision_id: str, user_id: int) -> dict[str, str]:
    """Render derived score pages for a saved revision."""

    async def _run() -> None:
        async with AsyncSessionLocal() as db:
            await RevisionRenderService().render(db, score_id, revision_id, user_id)

    asyncio.run(_run())
    logger.info("Rendered score revision %s/%s", score_id, revision_id)
    return {"status": "rendered", "score_id": score_id, "revision_id": revision_id}


@celery_app.task(
    name="app.worker.tasks.render_review_thumbnail_task",
    autoretry_for=(Exception,),
    ignore_result=True,
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 2},
)
def render_review_thumbnail_task(job_id: str) -> dict[str, str | None]:
    """Render the current review MusicXML into a job list thumbnail."""

    with get_worker_db() as db:
        artifact_id = review_thumbnail_service.render(db, job_id)
    logger.info("Rendered review thumbnail for %s: %s", job_id, artifact_id)
    return {"status": "rendered", "job_id": job_id, "artifact_id": artifact_id}


@celery_app.task(name="app.worker.tasks.run_job_maintenance")
def run_job_maintenance() -> dict[str, int]:
    """Run periodic import-job/upload maintenance."""

    with get_worker_db() as db:
        result = job_maintenance_service.run(db)

    return {
        "stale_pending_failed": result.stale_pending_failed,
        "stale_running_failed": result.stale_running_failed,
        "orphan_uploads_deleted": result.orphan_uploads_deleted,
    }


@celery_app.task(name="app.worker.tasks.run_notification_maintenance")
def run_notification_maintenance() -> dict[str, int]:
    """Run periodic user-notification cleanup."""

    with get_worker_db() as db:
        result = notification_maintenance_service.run(db)

    return {
        "expired_notifications_deleted": result.expired_notifications_deleted,
    }
