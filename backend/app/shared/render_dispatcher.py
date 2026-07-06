from __future__ import annotations

from app.core.logger import logger
from app.db.worker_session import get_worker_db
from app.modules.artifacts.render_outbox_service import render_outbox_service


def dispatch_render_outbox(outbox_uuid: str) -> bool:
    with get_worker_db() as db:
        if not render_outbox_service.mark_dispatched(db, outbox_uuid):
            return False

    try:
        from app.worker.tasks import render_score_revision_task

        render_score_revision_task.apply_async(
            kwargs={"outbox_uuid": outbox_uuid},
            task_id=f"revision-render-{outbox_uuid}",
        )
        return True
    except Exception as exc:
        with get_worker_db() as db:
            render_outbox_service.release_dispatch(db, outbox_uuid, str(exc))
        logger.warning(
            "Failed to dispatch revision render outbox {}: {}",
            outbox_uuid,
            exc,
        )
        return False


def enqueue_score_revision_render(outbox_uuid: str) -> None:
    try:
        from app.worker.tasks import render_score_revision_task

        render_score_revision_task.apply_async(
            kwargs={"outbox_uuid": outbox_uuid},
            task_id=f"revision-render-{outbox_uuid}",
        )
    except Exception as exc:
        logger.warning(
            "Failed to enqueue revision render outbox {}: {}",
            outbox_uuid,
            exc,
        )


def enqueue_review_thumbnail_render(job_id: str) -> None:
    try:
        from app.worker.tasks import render_review_thumbnail_task

        render_review_thumbnail_task.apply_async(kwargs={"job_id": job_id})
    except Exception as exc:
        logger.warning("Failed to enqueue review thumbnail render for %s: %s", job_id, exc)
