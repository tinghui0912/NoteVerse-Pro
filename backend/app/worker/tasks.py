"""Celery task entrypoints for score import jobs."""

import asyncio
from celery.utils.log import get_task_logger

from app.db.session import AsyncSessionLocal
from app.db.worker_session import get_worker_db
from app.modules.artifacts.render_service import RevisionRenderService
from app.modules.artifacts.render_outbox_service import render_outbox_service
from app.modules.import_jobs.execution_service import job_execution_service
from app.modules.import_jobs.maintenance_service import job_maintenance_service
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.modules.import_jobs.schemas import PipelineExecutionSuccessResult
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
    job_uuid: str,
) -> PipelineExecutionSuccessResult:
    """Run the score import pipeline for one or more input images."""

    with get_worker_db() as db:
        payload = import_dispatch_service.claim(db, job_uuid)
    if payload is None:
        return {"success": True, "job_id": job_uuid}

    try:
        result = job_execution_service.run_pipeline(
            self,
            job_uuid,
            payload.file_ids,
            payload.options,
        )
    except Exception:
        with get_worker_db() as db:
            import_dispatch_service.complete(db, job_uuid)
        raise

    with get_worker_db() as db:
        import_dispatch_service.complete(db, job_uuid)
    return result


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


@celery_app.task(name="app.worker.tasks.render_score_revision_task", ignore_result=True)
def render_score_revision_task(outbox_uuid: str) -> dict[str, str]:
    """Render derived score pages for a saved revision."""

    with get_worker_db() as db:
        payload = render_outbox_service.claim(db, outbox_uuid)
    if payload is None:
        return {"status": "ignored", "outbox_uuid": outbox_uuid}

    async def _run() -> None:
        async with AsyncSessionLocal() as db:
            await RevisionRenderService().render(
                db,
                payload.score_uuid,
                payload.revision_uuid,
                payload.user_id,
                profile=payload.render_profile,
            )

    try:
        asyncio.run(_run())
    except Exception as exc:
        with get_worker_db() as db:
            render_outbox_service.fail(db, outbox_uuid, str(exc))
        logger.exception("Revision render failed for outbox %s", outbox_uuid)
        return {"status": "failed", "outbox_uuid": outbox_uuid}

    with get_worker_db() as db:
        render_outbox_service.complete(db, outbox_uuid)
    logger.info("Rendered score revision %s/%s", payload.score_uuid, payload.revision_uuid)
    return {"status": "rendered", "outbox_uuid": outbox_uuid}


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
        "orphan_uploads_deleted": result.orphan_uploads_deleted,
    }


@celery_app.task(name="app.worker.tasks.run_import_dispatch_maintenance")
def run_import_dispatch_maintenance() -> dict[str, int]:
    """Recover stale import deliveries and dispatch all due jobs."""

    with get_worker_db() as db:
        due = import_dispatch_service.recover_and_claim_due(db)

    from app.shared.import_dispatcher import dispatch_import_job

    dispatched = sum(1 for job_uuid in due if dispatch_import_job(job_uuid))
    return {"due": len(due), "dispatched": dispatched}


@celery_app.task(name="app.worker.tasks.run_notification_maintenance")
def run_notification_maintenance() -> dict[str, int]:
    """Run periodic user-notification cleanup."""

    with get_worker_db() as db:
        result = notification_maintenance_service.run(db)

    return {
        "expired_notifications_deleted": result.expired_notifications_deleted,
    }


@celery_app.task(name="app.worker.tasks.run_render_outbox_maintenance")
def run_render_outbox_maintenance() -> dict[str, int]:
    """Recover stale render deliveries and dispatch all due outbox records."""

    with get_worker_db() as db:
        due = render_outbox_service.recover_and_list_due(db)

    from app.shared.render_dispatcher import dispatch_render_outbox

    dispatched = sum(1 for outbox_uuid in due if dispatch_render_outbox(outbox_uuid))
    return {"due": len(due), "dispatched": dispatched}
