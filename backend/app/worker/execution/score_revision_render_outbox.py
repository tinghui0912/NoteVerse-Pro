"""Execution handler for Score Revision Render tasks."""

from __future__ import annotations

from app.composition.media_resources import build_render_service

import sys
from sqlalchemy.orm import Session
from app.modules.durable_work.delivery import StaleDeliveryAttempt
from app.modules.revisions.presentation_demand import RevisionPresentationSuperseded

from app.core.background_tracing import record_current_attempt_failure
from app.db.session import SessionLocal
from app.modules.realtime.publisher import (
    publish_score_change,
)
from app.shared.realtime import RealtimeChangeKind
from app.modules.revisions.render_delivery import revision_render_delivery
from app.modules.revisions.render_target import (
    ScoreRevisionRenderAttempt,
    ScoreRevisionRenderTarget,
)
from app.task_queue.protocols import CeleryTaskLike
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    operation_logger,
    start_attempt_trace,
)


def execute_score_revision_render_task(
    task: CeleryTaskLike,
    outbox_uuid: str,
) -> dict[str, str | None]:
    """Render one durable Score Revision render demand."""

    bind_task_context(task)
    trace_scope = None
    try:
        with SessionLocal() as db:
            payload = revision_render_delivery.claim(db, outbox_uuid)
            db.commit()
        if payload is None:
            operation_logger(
                "revision_render.ignored",
                operation_kind="revision_render",
                outbox_id=outbox_uuid,
                status="ignored",
            ).info("revision_render.ignored")
            return {"status": "ignored", "outbox_uuid": outbox_uuid}

        trace_scope = start_attempt_trace(
            name="noteverse.revision_render.generate",
            operation_kind="revision_render",
            operation_id=outbox_uuid,
            attempt=payload.lease.attempt,
            traceparent=payload.target.traceparent,
            tracestate=payload.target.tracestate,
        )
        trace_scope.__enter__()

        context = _render_log_context(outbox_uuid, payload)
        operation_logger("revision_render.started", **context).info("revision_render.started")

        try:
            with SessionLocal() as db:
                _render_revision(db, payload)
                _publish_revision_render_change(db, payload.target)
                db.commit()
        except StaleDeliveryAttempt:
            return {"status": "stale", "outbox_uuid": outbox_uuid}
        except RevisionPresentationSuperseded:
            with SessionLocal() as db:
                accepted = revision_render_delivery.supersede(db, outbox_uuid, lease=payload.lease)
                db.commit()
            if not accepted:
                return {"status": "stale", "outbox_uuid": outbox_uuid}
            operation_logger("revision_render.superseded", **context, status="superseded").info(
                "revision_render.superseded"
            )
            return {"status": "superseded", "outbox_uuid": outbox_uuid}
        except Exception as exc:
            record_current_attempt_failure(exc)
            with SessionLocal() as db:
                accepted = revision_render_delivery.fail(
                    db, outbox_uuid, str(exc), lease=payload.lease
                )
                if accepted:
                    _publish_revision_render_change(db, payload.target)
                db.commit()
            if not accepted:
                return {"status": "stale", "outbox_uuid": outbox_uuid}
            operation_logger(
                "revision_render.failed",
                **context,
                status="failed",
                exception_type=type(exc).__name__,
            ).opt(exception=True).error("revision_render.failed")
            return {"status": "failed", "outbox_uuid": outbox_uuid}

        operation_logger(
            "revision_render.completed",
            **context,
            status="completed",
        ).info("revision_render.completed")
        return {"status": "rendered", "outbox_uuid": outbox_uuid}
    finally:
        if trace_scope is not None:
            trace_scope.__exit__(*sys.exc_info())
        clear_task_context()


def _render_revision(db: Session, payload: ScoreRevisionRenderAttempt) -> None:
    target = payload.target
    build_render_service().render_for_worker(
        db,
        target.score_uuid,
        target.revision_uuid,
        source_fingerprint=target.source_fingerprint,
        profile=target.render_profile,
        outbox_uuid=target.outbox_uuid,
        lease=payload.lease,
    )


def _publish_revision_render_change(db: Session, target: ScoreRevisionRenderTarget) -> None:
    publish_score_change(
        db,
        score_id=target.score_uuid,
        revision_id=target.revision_uuid,
        kind=RealtimeChangeKind.SCORE_DERIVED_ASSETS_CHANGED,
    )


def _render_log_context(
    outbox_uuid: str, payload: ScoreRevisionRenderAttempt
) -> dict[str, str | int | None]:
    target = payload.target
    return {
        "operation_kind": "revision_render",
        "outbox_id": outbox_uuid,
        "render_profile": target.render_profile,
        "attempt": payload.lease.attempt,
        "max_attempts": payload.max_attempts,
        "originating_request_id": target.originating_request_id,
        "score_id": target.score_uuid,
        "revision_id": target.revision_uuid,
    }
