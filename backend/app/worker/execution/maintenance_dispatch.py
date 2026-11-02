"""Execution handlers for periodic durable-dispatch recovery scans."""

from __future__ import annotations

from app.modules.performance_takes.upload_reservation.cleanup import upload_reservation_cleanup_service

from app.core.logger import logger
from app.db.sync_session import get_worker_db
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.modules.mail.outbox_service import mail_outbox_service
from app.modules.performance_takes.delete_outbox_service import (
    performance_take_delete_outbox_service,
)
from app.modules.practice.source.retention import (
    practice_source_delete_service,
)
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.modules.storage_usage.service import storage_usage_service
from app.storage import file_storage
from app.worker.task_runtime import run_scheduler_scan


def execute_import_dispatch_maintenance() -> dict[str, int]:
    """Recover stale import deliveries and dispatch all due jobs."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = import_dispatch_service.recover_and_claim_due(db)

        from app.worker.dispatch.import_jobs import dispatch_import_job

        dispatched = sum(1 for job_uuid in due if dispatch_import_job(job_uuid))
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


def execute_performance_take_deletion_maintenance() -> dict[str, int]:
    """Recover stale performance take deletions, dispatch due records, and clean expired reservations."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = performance_take_delete_outbox_service.recover_and_list_due(db)
            source_due = practice_source_delete_service.recover_and_list_due(db)
        cleanup_errors = 0
        try:
            with get_worker_db() as db:
                cleaned = upload_reservation_cleanup_service.cleanup_expired_reservations(
                    db, file_storage, storage_usage_service
                )
                db.commit()
        except Exception:
            cleanup_errors = 1
            cleaned = 0
            logger.exception("performance_take_deletion.cleanup_expired_reservations_failed")

        from app.worker.dispatch.performance_take_deletion import (
            dispatch_performance_take_deletion,
        )
        from app.worker.dispatch.practice_source_deletion import (
            dispatch_practice_source_deletion,
        )

        dispatched = sum(
            1
            for outbox_uuid in due
            if dispatch_performance_take_deletion(outbox_uuid)
        )
        source_dispatched = sum(
            1
            for outbox_uuid in source_due
            if dispatch_practice_source_deletion(outbox_uuid)
        )
        return {
            "due": len(due),
            "dispatched": dispatched,
            "source_due": len(source_due),
            "source_dispatched": source_dispatched,
            "cleaned_reservations": cleaned,
            "cleanup_errors": cleanup_errors,
        }

    return run_scheduler_scan("performance_take_deletion", scan)
