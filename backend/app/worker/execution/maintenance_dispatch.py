"""Execution handlers for periodic durable-dispatch recovery scans."""

from __future__ import annotations


from app.modules.media_storage.upload_sessions.maintenance import UploadSessionMaintenance

from app.modules.practice.bundle.retention import PracticeBundleRetention
from app.worker.task_runtime import run_scheduler_scan
from app.runtime.worker.context import get_context


def execute_import_dispatch_maintenance() -> dict[str, int]:
    """Recover stale import deliveries and dispatch all due jobs."""

    def scan() -> dict[str, int]:
        with get_context().sessions() as db:
            due = get_context().deliveries.imports.recover_and_list_due(db)
            db.commit()

        dispatched = sum(
            1
            for dispatch_uuid in due
            if get_context().dispatches.imports.dispatch_import_dispatch(dispatch_uuid)
        )
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("import_dispatch", scan)


def execute_score_revision_render_maintenance() -> dict[str, int]:
    """Recover stale render deliveries and dispatch all due outbox records."""

    def scan() -> dict[str, int]:
        with get_context().sessions() as db:
            due = get_context().deliveries.render.recover_and_list_due(db)
            db.commit()

        dispatched = sum(
            1
            for outbox_uuid in due
            if get_context().dispatches.render.dispatch_score_revision_render(outbox_uuid)
        )
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("score_revision_render_outbox", scan)


def execute_playback_outbox_maintenance() -> dict[str, int]:
    """Recover stale playback deliveries and dispatch all due outbox records."""

    def scan() -> dict[str, int]:
        with get_context().sessions() as db:
            due = get_context().deliveries.playback.recover_and_list_due(db)
            db.commit()

        dispatched = sum(
            1
            for outbox_uuid in due
            if get_context().dispatches.playback.dispatch_playback_outbox(outbox_uuid)
        )
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("playback_outbox", scan)


def execute_mail_outbox_maintenance() -> dict[str, int]:
    """Recover, dispatch, and expire durable mail records."""

    def scan() -> dict[str, int]:
        with get_context().sessions() as db:
            due = get_context().deliveries.mail.recover_and_list_due(db)
            db.commit()

        dispatched = sum(
            1
            for outbox_uuid in due
            if get_context().dispatches.mail.dispatch_mail_outbox(outbox_uuid)
        )
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("mail_outbox", scan)


def execute_stored_object_retirement_maintenance() -> dict[str, int]:
    def scan():
        with get_context().sessions() as db:
            PracticeBundleRetention(config=get_context().settings).recover_stale_creating(db)
            PracticeBundleRetention(config=get_context().settings).collect_unowned_ready(db)
            due = get_context().deliveries.retirement.recover_and_list_due(db)
            db.commit()
        with get_context().sessions() as db:
            expired = get_context().resources.build_take_reservation_cleanup_service().expire(db)
            db.commit()
        transfers = UploadSessionMaintenance(
            get_context().resources.build_upload_session_service()
        ).run()

        dispatched = sum(
            1
            for uuid in due
            if get_context().dispatches.retirement.dispatch_stored_object_retirement(uuid)
        )
        return {
            "due": len(due),
            "dispatched": dispatched,
            "expired_reservations": expired,
            **transfers,
        }

    return run_scheduler_scan("stored_object_retirement", scan)


def execute_object_write_cleanup_maintenance() -> dict[str, int]:

    def scan():
        with get_context().sessions() as db:
            due = get_context().deliveries.write_cleanup.recover_and_list_due(db)
            db.commit()
        return {
            "due": len(due),
            "dispatched": sum(
                1
                for uuid in due
                if get_context().dispatches.write_cleanup.dispatch_object_write_cleanup(uuid)
            ),
        }

    return run_scheduler_scan("object_write_cleanup", scan)


def execute_score_deletion_maintenance() -> dict[str, int]:

    def scan():
        with get_context().sessions() as db:
            due = get_context().deliveries.score_deletion.recover_and_list_due(db)
            db.commit()
        return {
            "due": len(due),
            "dispatched": sum(
                1
                for uuid in due
                if get_context().dispatches.score_deletion.dispatch_score_deletion(uuid)
            ),
        }

    return run_scheduler_scan("score_deletion", scan)
