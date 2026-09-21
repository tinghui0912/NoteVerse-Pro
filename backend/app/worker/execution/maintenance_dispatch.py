"""Execution handlers for periodic durable-dispatch recovery scans."""

from __future__ import annotations

from app.db.sync_session import get_worker_db
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.modules.mail.outbox_service import mail_outbox_service
from app.modules.performance_takes.delete_outbox_service import (
    performance_take_delete_outbox_service,
)
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.practice.replay_object_deletion_outbox_service import (
    practice_replay_object_deletion_outbox_service,
)
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

        from app.worker.dispatch.render_assets import dispatch_render_outbox

        dispatched = sum(1 for outbox_uuid in due if dispatch_render_outbox(outbox_uuid))
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("render_outbox", scan)


def execute_playback_outbox_maintenance() -> dict[str, int]:
    """Recover stale playback deliveries and dispatch all due outbox records."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = playback_outbox_service.recover_and_list_due(db)

        from app.worker.dispatch.playback_assets import dispatch_playback_outbox

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


def execute_practice_replay_object_deletion_maintenance() -> dict[str, int]:
    """Recover stale saved-replay object deletions and dispatch due records."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = practice_replay_object_deletion_outbox_service.recover_and_list_due(db)

        from app.worker.dispatch.practice_replay_object_deletion import (
            dispatch_practice_replay_object_deletion,
        )

        dispatched = sum(
            1
            for outbox_uuid in due
            if dispatch_practice_replay_object_deletion(outbox_uuid)
        )
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("practice_replay_object_deletion", scan)


def execute_performance_take_deletion_maintenance() -> dict[str, int]:
    """Recover stale performance take deletions, dispatch due records, and clean expired authorizations."""

    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            due = performance_take_delete_outbox_service.recover_and_list_due(db)
            cleaned = performance_take_delete_outbox_service.cleanup_expired_authorizations(
                db, file_storage, storage_usage_service
            )

        from app.worker.dispatch.performance_take_deletion import (
            dispatch_performance_take_deletion,
        )

        dispatched = sum(
            1
            for outbox_uuid in due
            if dispatch_performance_take_deletion(outbox_uuid)
        )
        return {"due": len(due), "dispatched": dispatched, "cleaned_authorizations": cleaned}

    return run_scheduler_scan("performance_take_deletion", scan)
