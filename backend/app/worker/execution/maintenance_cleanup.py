"""Execution handlers for periodic Worker cleanup scans."""

from __future__ import annotations


from app.worker.task_runtime import run_scheduler_scan
from app.runtime.worker.context import get_context


def execute_job_maintenance() -> dict[str, int]:
    """Run periodic import-job/upload maintenance."""

    def scan() -> dict[str, int]:
        with get_context().sessions.begin() as db:
            result = get_context().resources.build_import_maintenance_service().run(db)

        return {
            "orphan_uploads_deleted": result.orphan_uploads_deleted,
        }

    return run_scheduler_scan("job_maintenance", scan)


def execute_notification_maintenance() -> dict[str, int]:
    """Run periodic user-notification cleanup."""

    def scan() -> dict[str, int]:
        with get_context().sessions.begin() as db:
            result = get_context().deliveries.notifications.run(db)

        return {
            "expired_notifications_deleted": result.expired_notifications_deleted,
        }

    return run_scheduler_scan("notification_maintenance", scan)


def execute_realtime_maintenance() -> dict[str, int]:
    """Run periodic realtime-event cleanup."""

    def scan() -> dict[str, int]:
        cutoff = get_context().deliveries.realtime.retention_cutoff()
        with get_context().sessions() as db:
            recipients = get_context().deliveries.realtime.expired_recipient_ids(db, cutoff=cutoff)
        deleted = 0
        for recipient_user_id in recipients:
            with get_context().sessions.begin() as db:
                count = get_context().deliveries.realtime.cleanup_recipient(
                    db, recipient_user_id, cutoff=cutoff
                )
            deleted += count
        return {"expired_changes_deleted": deleted}

    return run_scheduler_scan("realtime_maintenance", scan)


def execute_derived_asset_cleanup() -> dict[str, int]:
    """Remove derived preview/audio assets outside the retention window."""

    def scan() -> dict[str, int]:
        with get_context().sessions() as db:
            score_ids = (
                get_context()
                .resources.build_derived_asset_retention_service()
                .candidate_score_ids(db)
            )
        rendered_pages = playback_assets = retirements = 0
        for score_id in score_ids:
            with get_context().sessions.begin() as db:
                result = (
                    get_context()
                    .resources.build_derived_asset_retention_service()
                    .cleanup_for_score(db, score_id=score_id)
                )
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
        with get_context().sessions.begin() as db:
            deleted = get_context().deliveries.mail.cleanup(db)
        return {"deleted": deleted}

    return run_scheduler_scan("mail_outbox_cleanup", scan)


def execute_storage_quota_expiry() -> dict[str, int]:
    """Expire bounded capacity holds independently of business cleanup."""
    from app.composition.storage_resources import storage_quota_expiry

    def scan() -> dict[str, int]:
        with get_context().sessions.begin() as db:
            expired = storage_quota_expiry.expire_due(db)
        return {"expired_holds": expired}

    return run_scheduler_scan("storage_quota_expiry", scan)
