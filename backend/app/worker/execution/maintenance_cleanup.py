"""Execution handlers for periodic Worker cleanup scans."""

from __future__ import annotations

from app.db.sync_session import get_worker_db
from app.modules.import_jobs.maintenance_service import job_maintenance_service
from app.modules.mail.outbox_service import mail_outbox_service
from app.modules.notifications.maintenance_service import notification_maintenance_service
from app.modules.realtime.maintenance_service import realtime_maintenance_service
from app.modules.revisions.derived_asset_retention_service import (
    derived_asset_retention_service,
)
from app.modules.scores.lifecycle_service import score_lifecycle_service
from app.worker.task_runtime import operation_logger, run_scheduler_scan


def execute_job_maintenance() -> dict[str, int]:
    """Run periodic import-job/upload maintenance."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            result = job_maintenance_service.run(db)

        return {
            "orphan_uploads_deleted": result.orphan_uploads_deleted,
        }

    return run_scheduler_scan("job_maintenance", scan)


def execute_notification_maintenance() -> dict[str, int]:
    """Run periodic user-notification cleanup."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            result = notification_maintenance_service.run(db)

        return {
            "expired_notifications_deleted": result.expired_notifications_deleted,
        }

    return run_scheduler_scan("notification_maintenance", scan)


def execute_realtime_maintenance() -> dict[str, int]:
    """Run periodic realtime-event cleanup."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            result = realtime_maintenance_service.run(db)

        return {
            "expired_events_deleted": result.expired_events_deleted,
        }

    return run_scheduler_scan("realtime_maintenance", scan)


def execute_derived_asset_cleanup() -> dict[str, int]:
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


def execute_score_deletion_cleanup() -> dict[str, int]:
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


def execute_mail_outbox_cleanup() -> dict[str, int]:
    """Delete terminal mail records after their retention window."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            deleted = mail_outbox_service.cleanup(db)
        return {"deleted": deleted}

    return run_scheduler_scan("mail_outbox_cleanup", scan)
