from __future__ import annotations

from app.core.logger import logger
from app.db.worker_session import get_worker_db
from app.modules.score_assets.render_outbox_service import render_outbox_service


def dispatch_render_outbox(outbox_uuid: str) -> bool:
    with get_worker_db() as db:
        if not render_outbox_service.mark_dispatched(db, outbox_uuid):
            return False

    try:
        from app.worker.tasks import render_outbox_task

        render_outbox_task.apply_async(
            kwargs={"outbox_uuid": outbox_uuid},
            task_id=f"render-{outbox_uuid}",
        )
        return True
    except Exception as exc:
        with get_worker_db() as db:
            render_outbox_service.release_dispatch(db, outbox_uuid, str(exc))
        logger.warning("Failed to dispatch render outbox {}: {}", outbox_uuid, exc)
        return False
