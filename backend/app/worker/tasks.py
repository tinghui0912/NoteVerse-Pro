"""Celery task entrypoints for NoteVerse background work."""

from app.db.sync_session import get_worker_db
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.modules.import_jobs.maintenance_service import job_maintenance_service
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.modules.import_jobs.schemas import PipelineExecutionSuccessResult
from app.modules.mail.outbox_service import mail_outbox_service
from app.modules.notifications.maintenance_service import notification_maintenance_service
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.realtime.maintenance_service import realtime_maintenance_service
from app.modules.revisions.derived_asset_retention_service import (
    derived_asset_retention_service,
)
from app.modules.scores.lifecycle_service import score_lifecycle_service
from app.pipeline.context import CeleryTaskLike
from app.worker.celery_config import celery_app
from app.worker.execution.import_job import execute_import_job_task
from app.worker.execution.mail_outbox import execute_mail_outbox_task
from app.worker.execution.playback_outbox import execute_playback_outbox_task
from app.worker.execution.render_outbox import execute_render_outbox_task
from app.worker.task_runtime import (
    operation_logger,
    run_scheduler_scan,
)


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
    return execute_import_job_task(self, job_uuid)


@celery_app.task(name="app.worker.tasks.send_mail_outbox_task", bind=True, ignore_result=True)
def send_mail_outbox_task(self: CeleryTaskLike, outbox_uuid: str) -> dict[str, str]:
    """Deliver one persistent transactional-mail record."""
    return execute_mail_outbox_task(self, outbox_uuid)


@celery_app.task(name="app.worker.tasks.render_outbox_task", bind=True, ignore_result=True)
def render_outbox_task(self: CeleryTaskLike, outbox_uuid: str) -> dict[str, str | None]:
    """Render one durable score-revision or review-thumbnail target."""
    return execute_render_outbox_task(self, outbox_uuid)


@celery_app.task(name="app.worker.tasks.playback_outbox_task", bind=True, ignore_result=True)
def playback_outbox_task(self: CeleryTaskLike, outbox_uuid: str) -> dict[str, str]:
    """Generate one durable score playback asset."""
    return execute_playback_outbox_task(self, outbox_uuid)


@celery_app.task(name="app.worker.tasks.run_job_maintenance")
def run_job_maintenance() -> dict[str, int]:
    """Run periodic import-job/upload maintenance."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            result = job_maintenance_service.run(db)

        return {
            "orphan_uploads_deleted": result.orphan_uploads_deleted,
        }

    return run_scheduler_scan("job_maintenance", scan)


@celery_app.task(name="app.worker.tasks.run_import_dispatch_maintenance")
def run_import_dispatch_maintenance() -> dict[str, int]:
    """Recover stale import deliveries and dispatch all due jobs."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = import_dispatch_service.recover_and_claim_due(db)

        from app.worker.dispatch.import_jobs import dispatch_import_job

        dispatched = sum(1 for job_uuid in due if dispatch_import_job(job_uuid))
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("import_dispatch", scan)


@celery_app.task(name="app.worker.tasks.run_notification_maintenance")
def run_notification_maintenance() -> dict[str, int]:
    """Run periodic user-notification cleanup."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            result = notification_maintenance_service.run(db)

        return {
            "expired_notifications_deleted": result.expired_notifications_deleted,
        }

    return run_scheduler_scan("notification_maintenance", scan)


@celery_app.task(name="app.worker.tasks.run_realtime_maintenance")
def run_realtime_maintenance() -> dict[str, int]:
    """Run periodic realtime-event cleanup."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            result = realtime_maintenance_service.run(db)

        return {
            "expired_events_deleted": result.expired_events_deleted,
        }

    return run_scheduler_scan("realtime_maintenance", scan)


@celery_app.task(name="app.worker.tasks.run_derived_asset_cleanup")
def run_derived_asset_cleanup() -> dict[str, int]:
    """Remove derived preview/audio assets outside the retention window."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            result = derived_asset_retention_service.cleanup_due_scores(db)

        return {
            "rendered_pages_deleted": result.rendered_pages_deleted,
            "playback_assets_deleted": result.playback_assets_deleted,
            "storage_objects_deleted": result.storage_objects_deleted,
        }

    return run_scheduler_scan("derived_asset_cleanup", scan)


@celery_app.task(name="app.worker.tasks.run_score_deletion_cleanup")
def run_score_deletion_cleanup() -> dict[str, int]:
    """Hard-delete scores that were hidden by a user deletion request."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            result = score_lifecycle_service.cleanup_deleting_scores(db)

        operation_logger(
            "score_deletion.cleanup_completed",
            operation_kind="score_deletion",
            scores_deleted=result.scores_deleted,
            storage_objects_deleted=result.storage_objects_deleted,
        ).info("score_deletion.cleanup_completed")
        return {
            "scores_deleted": result.scores_deleted,
            "storage_objects_deleted": result.storage_objects_deleted,
        }

    return run_scheduler_scan("score_deletion_cleanup", scan)


@celery_app.task(name="app.worker.tasks.run_render_outbox_maintenance")
def run_render_outbox_maintenance() -> dict[str, int]:
    """Recover stale render deliveries and dispatch all due outbox records."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = render_outbox_service.recover_and_list_due(db)

        from app.worker.dispatch.render_assets import dispatch_render_outbox

        dispatched = sum(1 for outbox_uuid in due if dispatch_render_outbox(outbox_uuid))
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("render_outbox", scan)


@celery_app.task(name="app.worker.tasks.run_playback_outbox_maintenance")
def run_playback_outbox_maintenance() -> dict[str, int]:
    """Recover stale playback deliveries and dispatch all due outbox records."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = playback_outbox_service.recover_and_list_due(db)

        from app.worker.dispatch.playback_assets import dispatch_playback_outbox

        dispatched = sum(1 for outbox_uuid in due if dispatch_playback_outbox(outbox_uuid))
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("playback_outbox", scan)


@celery_app.task(name="app.worker.tasks.run_mail_outbox_maintenance")
def run_mail_outbox_maintenance() -> dict[str, int]:
    """Recover, dispatch, and expire durable mail records."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = mail_outbox_service.recover_and_list_due(db)

        from app.worker.dispatch.mail import dispatch_mail_outbox

        dispatched = sum(1 for outbox_uuid in due if dispatch_mail_outbox(outbox_uuid))
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("mail_outbox", scan)


@celery_app.task(name="app.worker.tasks.run_mail_outbox_cleanup")
def run_mail_outbox_cleanup() -> dict[str, int]:
    """Delete terminal mail records after their retention window."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            deleted = mail_outbox_service.cleanup(db)
        return {"deleted": deleted}

    return run_scheduler_scan("mail_outbox_cleanup", scan)
