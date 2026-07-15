from __future__ import annotations

from app.core.logger import logger
from app.db.worker_session import get_worker_db
from app.modules.playback.outbox_service import playback_outbox_service


def dispatch_playback_outbox(outbox_uuid: str) -> bool:
    with get_worker_db() as db:
        if not playback_outbox_service.mark_dispatched(db, outbox_uuid):
            return False

    try:
        from app.worker.tasks import playback_outbox_task

        playback_outbox_task.apply_async(
            kwargs={"outbox_uuid": outbox_uuid},
            task_id=f"playback-{outbox_uuid}",
        )
        logger.bind(
            event="playback.dispatched",
            operation_kind="playback",
            outbox_id=outbox_uuid,
            task_id=f"playback-{outbox_uuid}",
        ).info("playback.dispatched")
        return True
    except Exception as exc:
        with get_worker_db() as db:
            playback_outbox_service.release_dispatch(db, outbox_uuid, str(exc))
        logger.bind(
            event="playback.dispatch_failed",
            operation_kind="playback",
            outbox_id=outbox_uuid,
            task_id=f"playback-{outbox_uuid}",
            exception_type=type(exc).__name__,
        ).opt(exception=True).warning("playback.dispatch_failed")
        return False
