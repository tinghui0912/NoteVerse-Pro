"""Execution handler for render outbox Celery tasks."""

from __future__ import annotations

import sys
from sqlalchemy.orm import Session
from app.modules.durable_work.delivery import StaleDeliveryAttempt
from app.modules.revisions.presentation_demand import RevisionPresentationSuperseded

from app.core.background_tracing import record_current_attempt_failure
from app.db.session import SessionLocal
from app.modules.realtime.publisher import (
    RealtimeChangeKind,
    publish_score_change,
)
from app.modules.import_jobs.review.thumbnail_service import import_review_thumbnail_service
from app.modules.rendering.delivery import render_outbox_service
from app.modules.rendering.targets import (
    RenderAttempt,
    ScoreRevisionRenderTarget,
    ReviewThumbnailRenderTarget,
)
from app.modules.score_assets.score_revision_rendering import ScoreRevisionRenderService
from app.task_queue.protocols import CeleryTaskLike
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    operation_logger,
    start_attempt_trace,
)


def execute_render_outbox_task(
    task: CeleryTaskLike,
    outbox_uuid: str,
) -> dict[str, str | None]:
    """Render one durable score-revision or review-thumbnail target."""

    bind_task_context(task)
    trace_scope = None
    try:
        with SessionLocal() as db:
            payload = render_outbox_service.claim(db, outbox_uuid)
            db.commit()
        if payload is None:
            operation_logger(
                "render.ignored",
                operation_kind="render",
                outbox_id=outbox_uuid,
                status="ignored",
            ).info("render.ignored")
            return {"status": "ignored", "outbox_uuid": outbox_uuid}

        trace_scope = start_attempt_trace(
            name="noteverse.render.generate",
            operation_kind="render",
            operation_id=outbox_uuid,
            attempt=payload.lease.attempt,
            traceparent=payload.target.traceparent,
            tracestate=payload.target.tracestate,
        )
        trace_scope.__enter__()

        context = _render_log_context(outbox_uuid, payload)
        operation_logger("render.started", **context).info("render.started")

        try:
            with SessionLocal() as db:
                artifact_id = _render_target(db, payload)
                if isinstance(payload.target, ScoreRevisionRenderTarget):
                    _publish_revision_render_change(db, payload.target)
                db.commit()
        except StaleDeliveryAttempt:
            return {"status": "stale", "outbox_uuid": outbox_uuid}
        except RevisionPresentationSuperseded:
            with SessionLocal() as db:
                accepted = render_outbox_service.supersede(db, outbox_uuid, lease=payload.lease)
                db.commit()
            if not accepted:
                return {"status": "stale", "outbox_uuid": outbox_uuid}
            operation_logger("render.superseded", **context, status="superseded").info(
                "render.superseded"
            )
            return {"status": "superseded", "outbox_uuid": outbox_uuid}
        except Exception as exc:
            record_current_attempt_failure(exc)
            with SessionLocal() as db:
                accepted = render_outbox_service.fail(
                    db, outbox_uuid, str(exc), lease=payload.lease
                )
                if accepted and isinstance(payload.target, ScoreRevisionRenderTarget):
                    _publish_revision_render_change(db, payload.target)
                db.commit()
            if not accepted:
                return {"status": "stale", "outbox_uuid": outbox_uuid}
            operation_logger(
                "render.failed",
                **context,
                status="failed",
                exception_type=type(exc).__name__,
            ).opt(exception=True).error("render.failed")
            return {"status": "failed", "outbox_uuid": outbox_uuid}

        operation_logger(
            "render.completed",
            **context,
            status="completed",
            artifact_id=artifact_id,
        ).info("render.completed")
        return {"status": "rendered", "outbox_uuid": outbox_uuid, "artifact_id": artifact_id}
    finally:
        if trace_scope is not None:
            trace_scope.__exit__(*sys.exc_info())
        clear_task_context()


def _render_target(db: Session, payload: RenderAttempt) -> str | None:
    target = payload.target
    if isinstance(target, ScoreRevisionRenderTarget):
        ScoreRevisionRenderService().render_for_worker(
            db,
            target.score_uuid,
            target.revision_uuid,
            source_fingerprint=target.source_fingerprint,
            profile=target.render_profile,
            outbox_uuid=target.outbox_uuid,
            lease=payload.lease,
        )
        return None
    if isinstance(target, ReviewThumbnailRenderTarget):
        return import_review_thumbnail_service.render(
            db,
            target.job_uuid,
            expected_source_fingerprint=target.source_fingerprint,
            outbox_uuid=target.outbox_uuid,
            lease=payload.lease,
            profile=target.render_profile,
        )
    raise TypeError("Unsupported render target")


def _publish_revision_render_change(db: Session, target: ScoreRevisionRenderTarget) -> None:
    publish_score_change(
        db,
        score_id=target.score_uuid,
        revision_id=target.revision_uuid,
        kind=RealtimeChangeKind.SCORE_DERIVED_ASSETS_CHANGED,
    )


def _render_log_context(outbox_uuid: str, payload: RenderAttempt) -> dict[str, str | int | None]:
    target = payload.target
    context: dict[str, str | int | None] = {
        "operation_kind": "render",
        "outbox_id": outbox_uuid,
        "target_type": target.target_type.value,
        "render_profile": target.render_profile,
        "attempt": payload.lease.attempt,
        "max_attempts": payload.max_attempts,
        "originating_request_id": target.originating_request_id,
        "score_id": None,
        "revision_id": None,
        "job_id": None,
    }
    if isinstance(target, ScoreRevisionRenderTarget):
        context.update(score_id=target.score_uuid, revision_id=target.revision_uuid)
    else:
        context.update(job_id=target.job_uuid)
    return context
