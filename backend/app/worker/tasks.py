"""Celery task entrypoints for score import jobs."""

from celery.utils.log import get_task_logger

from app.db.models import RenderTargetType
from app.db.worker_session import get_worker_db
from app.modules.score_assets.render_service import RevisionRenderService
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.modules.import_jobs.execution_service import job_execution_service
from app.modules.import_jobs.maintenance_service import job_maintenance_service
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.modules.import_jobs.schemas import PipelineExecutionSuccessResult
from app.modules.mail.outbox_service import mail_outbox_service
from app.modules.notifications.maintenance_service import notification_maintenance_service
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.playback.service import PlaybackService
from app.modules.realtime.publisher import (
    RealtimeEventTypes,
    publish_score_event_sync_best_effort,
)
from app.modules.realtime.maintenance_service import realtime_maintenance_service
from app.modules.revisions.derived_asset_retention_service import (
    derived_asset_retention_service,
)
from app.modules.review.thumbnail_service import review_thumbnail_service
from app.modules.scores.lifecycle_service import score_lifecycle_service
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
            payload.storage_keys,
            payload.options,
        )
    except Exception:
        with get_worker_db() as db:
            import_dispatch_service.complete(db, job_uuid)
        raise

    with get_worker_db() as db:
        import_dispatch_service.complete(db, job_uuid)
    return result


@celery_app.task(name="app.worker.tasks.send_mail_outbox_task", ignore_result=True)
def send_mail_outbox_task(outbox_uuid: str) -> dict[str, str]:
    """Deliver one persistent transactional-mail record."""
    with get_worker_db() as db:
        payload = mail_outbox_service.claim(db, outbox_uuid)
    if payload is None:
        return {"status": "ignored", "outbox_uuid": outbox_uuid}
    try:
        provider_message_id = send_email(
            to_email=payload.recipient,
            subject=payload.subject,
            body=payload.text_body,
            html_body=payload.html_body,
        )
    except MailPermanentError as exc:
        with get_worker_db() as db:
            mail_outbox_service.permanent_failure(db, outbox_uuid, str(exc))
        logger.error("Mail delivery failed permanently for outbox %s: %s", outbox_uuid, exc)
        return {"status": "permanent_failure", "outbox_uuid": outbox_uuid}
    except MailTransientError as exc:
        with get_worker_db() as db:
            mail_outbox_service.transient_failure(db, outbox_uuid, str(exc))
        logger.warning("Mail delivery failed transiently for outbox %s: %s", outbox_uuid, exc)
        return {"status": "failed", "outbox_uuid": outbox_uuid}
    with get_worker_db() as db:
        mail_outbox_service.sent(db, outbox_uuid, provider_message_id)
    logger.info("Mail sent for outbox %s", outbox_uuid)
    return {"status": "sent", "outbox_uuid": outbox_uuid}


@celery_app.task(name="app.worker.tasks.render_outbox_task", ignore_result=True)
def render_outbox_task(outbox_uuid: str) -> dict[str, str | None]:
    """Render one durable score-revision or review-thumbnail target."""

    with get_worker_db() as db:
        payload = render_outbox_service.claim(db, outbox_uuid)
    if payload is None:
        return {"status": "ignored", "outbox_uuid": outbox_uuid}

    try:
        artifact_id: str | None = None
        if payload.target_type == RenderTargetType.SCORE_REVISION:
            score_uuid = payload.score_uuid
            revision_uuid = payload.revision_uuid
            user_id = payload.user_id
            if score_uuid is None or revision_uuid is None or user_id is None:
                raise ValueError("Revision render payload is incomplete")

            with get_worker_db() as db:
                RevisionRenderService().render_sync(
                    db,
                    score_uuid,
                    revision_uuid,
                    user_id,
                    profile=payload.render_profile,
                )
        elif payload.target_type == RenderTargetType.REVIEW_THUMBNAIL:
            if payload.job_uuid is None:
                raise ValueError("Review thumbnail render payload is incomplete")
            with get_worker_db() as db:
                artifact_id = review_thumbnail_service.render(
                    db,
                    payload.job_uuid,
                    expected_source_fingerprint=payload.source_fingerprint,
                )
        else:
            raise ValueError(f"Unsupported render target: {payload.target_type}")
    except Exception as exc:
        with get_worker_db() as db:
            render_outbox_service.fail(db, outbox_uuid, str(exc))
            if (
                payload.target_type == RenderTargetType.SCORE_REVISION
                and payload.score_uuid
                and payload.revision_uuid
            ):
                publish_score_event_sync_best_effort(
                    db,
                    score_id=payload.score_uuid,
                    revision_id=payload.revision_uuid,
                    type=RealtimeEventTypes.SCORE_DERIVED_ASSET_UPDATED,
                    payload={
                        "score_id": payload.score_uuid,
                        "revision_id": payload.revision_uuid,
                        "asset": "preview",
                        "status": "failed",
                    },
                )
        logger.exception("Render failed for outbox %s", outbox_uuid)
        return {"status": "failed", "outbox_uuid": outbox_uuid}

    with get_worker_db() as db:
        render_outbox_service.complete(db, outbox_uuid)
        if (
            payload.target_type == RenderTargetType.SCORE_REVISION
            and payload.score_uuid
            and payload.revision_uuid
        ):
            publish_score_event_sync_best_effort(
                db,
                score_id=payload.score_uuid,
                revision_id=payload.revision_uuid,
                type=RealtimeEventTypes.SCORE_DERIVED_ASSET_UPDATED,
                payload={
                    "score_id": payload.score_uuid,
                    "revision_id": payload.revision_uuid,
                    "asset": "preview",
                    "status": "ready",
                },
            )
    logger.info("Rendered %s for outbox %s", payload.target_type.value, outbox_uuid)
    return {"status": "rendered", "outbox_uuid": outbox_uuid, "artifact_id": artifact_id}


@celery_app.task(name="app.worker.tasks.playback_outbox_task", ignore_result=True)
def playback_outbox_task(outbox_uuid: str) -> dict[str, str]:
    """Generate one durable score playback asset."""

    with get_worker_db() as db:
        payload = playback_outbox_service.claim(db, outbox_uuid)
    if payload is None:
        return {"status": "ignored", "outbox_uuid": outbox_uuid}

    try:
        with get_worker_db() as db:
            PlaybackService().render_sync(
                db,
                payload.score_uuid,
                payload.revision_uuid,
                source_fingerprint=payload.source_fingerprint,
                asset_kind=payload.asset_kind,
            )
    except Exception as exc:
        with get_worker_db() as db:
            playback_outbox_service.fail(db, outbox_uuid, str(exc))
            publish_score_event_sync_best_effort(
                db,
                score_id=payload.score_uuid,
                revision_id=payload.revision_uuid,
                type=RealtimeEventTypes.SCORE_DERIVED_ASSET_UPDATED,
                payload={
                    "score_id": payload.score_uuid,
                    "revision_id": payload.revision_uuid,
                    "asset": "audio",
                    "status": "failed",
                },
            )
        logger.exception("Playback generation failed for outbox %s", outbox_uuid)
        return {"status": "failed", "outbox_uuid": outbox_uuid}

    with get_worker_db() as db:
        playback_outbox_service.complete(db, outbox_uuid)
        publish_score_event_sync_best_effort(
            db,
            score_id=payload.score_uuid,
            revision_id=payload.revision_uuid,
            type=RealtimeEventTypes.SCORE_DERIVED_ASSET_UPDATED,
            payload={
                "score_id": payload.score_uuid,
                "revision_id": payload.revision_uuid,
                "asset": "audio",
                "status": "ready",
            },
        )
    logger.info("Generated playback asset for outbox %s", outbox_uuid)
    return {"status": "generated", "outbox_uuid": outbox_uuid}


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


@celery_app.task(name="app.worker.tasks.run_realtime_maintenance")
def run_realtime_maintenance() -> dict[str, int]:
    """Run periodic realtime-event cleanup."""

    with get_worker_db() as db:
        result = realtime_maintenance_service.run(db)

    return {
        "expired_events_deleted": result.expired_events_deleted,
    }


@celery_app.task(name="app.worker.tasks.run_derived_asset_cleanup")
def run_derived_asset_cleanup() -> dict[str, int]:
    """Remove derived preview/audio assets outside the retention window."""

    with get_worker_db() as db:
        result = derived_asset_retention_service.cleanup_due_scores(db)

    return {
        "rendered_pages_deleted": result.rendered_pages_deleted,
        "playback_assets_deleted": result.playback_assets_deleted,
        "storage_objects_deleted": result.storage_objects_deleted,
    }


@celery_app.task(name="app.worker.tasks.run_score_deletion_cleanup")
def run_score_deletion_cleanup() -> dict[str, int]:
    """Hard-delete scores that were hidden by a user deletion request."""

    with get_worker_db() as db:
        result = score_lifecycle_service.cleanup_deleting_scores(db)

    return {
        "scores_deleted": result.scores_deleted,
        "storage_objects_deleted": result.storage_objects_deleted,
    }


@celery_app.task(name="app.worker.tasks.run_render_outbox_maintenance")
def run_render_outbox_maintenance() -> dict[str, int]:
    """Recover stale render deliveries and dispatch all due outbox records."""

    with get_worker_db() as db:
        due = render_outbox_service.recover_and_list_due(db)

    from app.shared.render_dispatcher import dispatch_render_outbox

    dispatched = sum(1 for outbox_uuid in due if dispatch_render_outbox(outbox_uuid))
    return {"due": len(due), "dispatched": dispatched}


@celery_app.task(name="app.worker.tasks.run_playback_outbox_maintenance")
def run_playback_outbox_maintenance() -> dict[str, int]:
    """Recover stale playback deliveries and dispatch all due outbox records."""

    with get_worker_db() as db:
        due = playback_outbox_service.recover_and_list_due(db)

    from app.shared.playback_dispatcher import dispatch_playback_outbox

    dispatched = sum(1 for outbox_uuid in due if dispatch_playback_outbox(outbox_uuid))
    return {"due": len(due), "dispatched": dispatched}


@celery_app.task(name="app.worker.tasks.run_mail_outbox_maintenance")
def run_mail_outbox_maintenance() -> dict[str, int]:
    """Recover, dispatch, and expire durable mail records."""
    with get_worker_db() as db:
        due = mail_outbox_service.recover_and_list_due(db)

    from app.shared.mail_dispatcher import dispatch_mail_outbox

    dispatched = sum(1 for outbox_uuid in due if dispatch_mail_outbox(outbox_uuid))
    return {"due": len(due), "dispatched": dispatched}


@celery_app.task(name="app.worker.tasks.run_mail_outbox_cleanup")
def run_mail_outbox_cleanup() -> dict[str, int]:
    """Delete terminal mail records after their retention window."""
    with get_worker_db() as db:
        deleted = mail_outbox_service.cleanup(db)
    return {"deleted": deleted}
