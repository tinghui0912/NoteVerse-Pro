"""Execution handlers for periodic Worker cleanup scans."""

from __future__ import annotations

from app.db.session import SessionLocal
from app.modules.import_jobs.maintenance_service import job_maintenance_service
from app.modules.mail.outbox_service import mail_outbox_service
from app.modules.notifications.maintenance_service import notification_maintenance_service
from app.modules.realtime.maintenance_service import realtime_maintenance_service
from app.modules.revisions.derived_asset_retention_service import (
    derived_asset_retention_service,
)
from app.worker.task_runtime import run_scheduler_scan


def execute_job_maintenance() -> dict[str, int]:
    """Run periodic import-job/upload maintenance."""

    def scan() -> dict[str, int]:
        with SessionLocal.begin() as db:
            result = job_maintenance_service.run(db)

        return {
            "orphan_uploads_deleted": result.orphan_uploads_deleted,
        }

    return run_scheduler_scan("job_maintenance", scan)


def execute_notification_maintenance() -> dict[str, int]:
    """Run periodic user-notification cleanup."""

    def scan() -> dict[str, int]:
        with SessionLocal.begin() as db:
            result = notification_maintenance_service.run(db)

        return {
            "expired_notifications_deleted": result.expired_notifications_deleted,
        }

    return run_scheduler_scan("notification_maintenance", scan)


def execute_realtime_maintenance() -> dict[str, int]:
    """Run periodic realtime-event cleanup."""

    def scan() -> dict[str, int]:
        cutoff = realtime_maintenance_service.retention_cutoff()
        with SessionLocal() as db:
            recipients = realtime_maintenance_service.expired_recipient_ids(db, cutoff=cutoff)
        deleted = 0
        for recipient_user_id in recipients:
            with SessionLocal.begin() as db:
                count = realtime_maintenance_service.cleanup_recipient(
                    db, recipient_user_id, cutoff=cutoff
                )
            deleted += count
        return {"expired_changes_deleted": deleted}

    return run_scheduler_scan("realtime_maintenance", scan)


def execute_derived_asset_cleanup() -> dict[str, int]:
    """Remove derived preview/audio assets outside the retention window."""

    def scan() -> dict[str, int]:
        with SessionLocal() as db:
            score_ids = derived_asset_retention_service.candidate_score_ids(db)
        rendered_pages = playback_assets = retirements = 0
        for score_id in score_ids:
            with SessionLocal.begin() as db:
                result = derived_asset_retention_service.cleanup_for_score(db, score_id=score_id)
            rendered_pages += result.rendered_pages_deleted
            playback_assets += result.playback_assets_deleted
            retirements += result.object_retirements_queued
        return {
            "rendered_pages_deleted": rendered_pages,
            "playback_assets_deleted": playback_assets,
            "object_retirements_queued": retirements,
        }

    return run_scheduler_scan("derived_asset_cleanup", scan)


def execute_mail_outbox_cleanup() -> dict[str, int]:
    """Delete terminal mail records after their retention window."""

    def scan() -> dict[str, int]:
        with SessionLocal.begin() as db:
            deleted = mail_outbox_service.cleanup(db)
        return {"deleted": deleted}

    return run_scheduler_scan("mail_outbox_cleanup", scan)
