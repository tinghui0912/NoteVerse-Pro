"""Execution handler for render outbox Celery tasks."""

from __future__ import annotations

import sys
from typing import Any

from app.core.background_tracing import record_current_attempt_failure
from app.db.models import RenderTargetType
from app.db.sync_session import get_worker_db
from app.modules.realtime.publisher import (
    RealtimeEventTypes,
    publish_score_event_sync_best_effort,
)
from app.modules.review.thumbnail_service import review_thumbnail_service
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.modules.score_assets.render_payloads import RenderOutboxPayload
from app.modules.score_assets.render_service import RevisionRenderService
from app.pipeline.context import CeleryTaskLike
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
        with get_worker_db() as db:
            payload = render_outbox_service.claim(db, outbox_uuid)
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
            attempt=payload.attempt,
            traceparent=payload.traceparent,
            tracestate=payload.tracestate,
        )
        trace_scope.__enter__()

        context = _render_log_context(outbox_uuid, payload)
        operation_logger("render.started", **context).info("render.started")

        try:
            artifact_id = _render_target(payload)
        except Exception as exc:
            record_current_attempt_failure(exc)
            with get_worker_db() as db:
                render_outbox_service.fail(db, outbox_uuid, str(exc))
                if _is_score_revision_render(payload):
                    _publish_revision_render_status(db, payload, "failed")
            operation_logger(
                "render.failed",
                **context,
                status="failed",
                exception_type=type(exc).__name__,
            ).opt(exception=True).error("render.failed")
            return {"status": "failed", "outbox_uuid": outbox_uuid}

        with get_worker_db() as db:
            render_outbox_service.complete(db, outbox_uuid)
            if _is_score_revision_render(payload):
                _publish_revision_render_status(db, payload, "ready")
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


def _render_target(payload: RenderOutboxPayload) -> str | None:
    if payload.target_type == RenderTargetType.SCORE_REVISION:
        _render_score_revision(payload)
        return None
    if payload.target_type == RenderTargetType.REVIEW_THUMBNAIL:
        return _render_review_thumbnail(payload)
    raise ValueError(f"Unsupported render target: {payload.target_type}")


def _render_score_revision(payload: RenderOutboxPayload) -> None:
    if payload.score_uuid is None or payload.revision_uuid is None or payload.user_id is None:
        raise ValueError("Revision render payload is incomplete")

    with get_worker_db() as db:
        RevisionRenderService().render_for_worker(
            db,
            payload.score_uuid,
            payload.revision_uuid,
            source_fingerprint=payload.source_fingerprint,
            profile=payload.render_profile,
        )


def _render_review_thumbnail(payload: RenderOutboxPayload) -> str | None:
    if payload.job_uuid is None:
        raise ValueError("Review thumbnail render payload is incomplete")

    with get_worker_db() as db:
        return review_thumbnail_service.render(
            db,
            payload.job_uuid,
            expected_source_fingerprint=payload.source_fingerprint,
        )


def _publish_revision_render_status(
    db: Any,
    payload: RenderOutboxPayload,
    status: str,
) -> None:
    if payload.score_uuid is None or payload.revision_uuid is None:
        return
    publish_score_event_sync_best_effort(
        db,
        score_id=payload.score_uuid,
        revision_id=payload.revision_uuid,
        type=RealtimeEventTypes.SCORE_DERIVED_ASSET_UPDATED,
        payload={
            "score_id": payload.score_uuid,
            "revision_id": payload.revision_uuid,
            "asset": "preview",
            "status": status,
        },
    )


def _is_score_revision_render(payload: RenderOutboxPayload) -> bool:
    return payload.target_type == RenderTargetType.SCORE_REVISION


def _render_log_context(
    outbox_uuid: str,
    payload: RenderOutboxPayload,
) -> dict[str, str | int | None]:
    return {
        "operation_kind": "render",
        "outbox_id": outbox_uuid,
        "target_type": payload.target_type.value,
        "score_id": payload.score_uuid,
        "revision_id": payload.revision_uuid,
        "job_id": payload.job_uuid,
        "render_profile": payload.render_profile,
        "attempt": payload.attempt,
        "max_attempts": payload.max_attempts,
        "originating_request_id": payload.originating_request_id,
    }
