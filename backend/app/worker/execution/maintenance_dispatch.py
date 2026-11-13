"""Execution handlers for periodic durable-dispatch recovery scans."""

from __future__ import annotations

from app.modules.performance_takes.upload_reservation.cleanup import (
    upload_reservation_cleanup_service,
)

from app.core.logger import logger
from app.db.sync_session import get_worker_db
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.modules.mail.outbox_service import mail_outbox_service
from app.modules.storage_objects.retirement import retirement_delivery
from app.modules.practice.bundle.retention import practice_bundle_retention
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.modules.storage_usage.service import storage_usage_service
from app.storage import object_storage
from app.worker.task_runtime import run_scheduler_scan


def execute_import_dispatch_maintenance() -> dict[str, int]:
    """Recover stale import deliveries and dispatch all due jobs."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = import_dispatch_service.recover_and_list_due(db)

        from app.worker.dispatch.import_jobs import dispatch_import_dispatch

        dispatched = sum(1 for dispatch_uuid in due if dispatch_import_dispatch(dispatch_uuid))
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("import_dispatch", scan)


def execute_render_outbox_maintenance() -> dict[str, int]:
    """Recover stale render deliveries and dispatch all due outbox records."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = render_outbox_service.recover_and_list_due(db)

        from app.modules.revisions.dispatch import dispatch_render_outbox

        dispatched = sum(1 for outbox_uuid in due if dispatch_render_outbox(outbox_uuid))
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("render_outbox", scan)


def execute_playback_outbox_maintenance() -> dict[str, int]:
    """Recover stale playback deliveries and dispatch all due outbox records."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = playback_outbox_service.recover_and_list_due(db)

        from app.modules.revisions.dispatch import dispatch_playback_outbox

        dispatched = sum(1 for outbox_uuid in due if dispatch_playback_outbox(outbox_uuid))
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("playback_outbox", scan)


def execute_mail_outbox_maintenance() -> dict[str, int]:
    """Recover, dispatch, and expire durable mail records."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = mail_outbox_service.recover_and_list_due(db)

        from app.worker.dispatch.mail import dispatch_mail_outbox

        dispatched = sum(1 for outbox_uuid in due if dispatch_mail_outbox(outbox_uuid))
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("mail_outbox", scan)


def execute_stored_object_retirement_maintenance() -> dict[str, int]:
    def scan():
        with get_worker_db() as db:
            practice_bundle_retention.recover_stale_creating(db)
            practice_bundle_retention.collect_unowned_ready(db)
            due = retirement_delivery.recover_and_list_due(db)
        errors, cleaned = 0, 0
        try:
            with get_worker_db() as db:
                cleaned = upload_reservation_cleanup_service.cleanup_expired_reservations(
                    db, object_storage, storage_usage_service
                )
        except Exception:
            errors = 1
            logger.exception("upload_reservation.cleanup_failed")
        from app.worker.dispatch.stored_object_retirement import dispatch_stored_object_retirement

        dispatched = sum(1 for uuid in due if dispatch_stored_object_retirement(uuid))
        return {
            "due": len(due),
            "dispatched": dispatched,
            "cleaned_reservations": cleaned,
            "cleanup_errors": errors,
        }

    return run_scheduler_scan("stored_object_retirement", scan)


def execute_object_write_cleanup_maintenance() -> dict[str, int]:
    from app.modules.storage_objects.writes import write_cleanup_delivery
    from app.worker.dispatch.object_write_cleanup import dispatch_object_write_cleanup

    def scan():
        with get_worker_db() as db:
            due = write_cleanup_delivery.recover_and_list_due(db)
        return {
            "due": len(due),
            "dispatched": sum(1 for uuid in due if dispatch_object_write_cleanup(uuid)),
        }

    return run_scheduler_scan("object_write_cleanup", scan)


def execute_score_deletion_maintenance() -> dict[str, int]:
    from app.modules.scores.deletion_delivery import score_deletion_delivery
    from app.worker.dispatch.score_deletion import dispatch_score_deletion

    def scan():
        with get_worker_db() as db:
            due = score_deletion_delivery.recover_and_list_due(db)
        return {
            "due": len(due),
            "dispatched": sum(1 for uuid in due if dispatch_score_deletion(uuid)),
        }

    return run_scheduler_scan("score_deletion", scan)
