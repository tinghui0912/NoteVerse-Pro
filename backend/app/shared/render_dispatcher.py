from __future__ import annotations

from app.core.logger import logger


def enqueue_score_revision_render(score_id: str, revision_id: str, user_id: int) -> None:
    try:
        from app.worker.tasks import render_score_revision_task

        render_score_revision_task.apply_async(
            kwargs={
                "score_id": score_id,
                "revision_id": revision_id,
                "user_id": user_id,
            }
        )
    except Exception as exc:
        logger.warning(
            "Failed to enqueue score revision render for %s/%s: %s",
            score_id,
            revision_id,
            exc,
        )


def enqueue_review_thumbnail_render(job_id: str) -> None:
    try:
        from app.worker.tasks import render_review_thumbnail_task

        render_review_thumbnail_task.apply_async(kwargs={"job_id": job_id})
    except Exception as exc:
        logger.warning("Failed to enqueue review thumbnail render for %s: %s", job_id, exc)
