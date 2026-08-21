"""Execution handler for playback outbox Celery tasks."""

from __future__ import annotations

import sys
from typing import Any

from app.core.background_tracing import record_current_attempt_failure
from app.db.sync_session import get_worker_db
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.playback.service import PlaybackGenerationService
from app.modules.realtime.publisher import (
    RealtimeEventTypes,
    publish_score_event_sync_best_effort,
)
from app.pipeline.context import CeleryTaskLike
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    operation_logger,
    start_attempt_trace,
)


def execute_playback_outbox_task(task: CeleryTaskLike, outbox_uuid: str) -> dict[str, str]:
    """Generate one durable score playback asset."""

    bind_task_context(task)
    trace_scope = None
    try:
        with get_worker_db() as db:
            payload = playback_outbox_service.claim(db, outbox_uuid)
        if payload is None:
            operation_logger(
                "playback.ignored",
                operation_kind="playback",
                outbox_id=outbox_uuid,
                status="ignored",
            ).info("playback.ignored")
            return {"status": "ignored", "outbox_uuid": outbox_uuid}

        trace_scope = start_attempt_trace(
            name="noteverse.playback.generate",
            operation_kind="playback",
            operation_id=outbox_uuid,
            attempt=payload.attempt,
            traceparent=payload.traceparent,
            tracestate=payload.tracestate,
        )
        trace_scope.__enter__()

        context = {
            "operation_kind": "playback",
            "outbox_id": outbox_uuid,
            "score_id": payload.score_uuid,
            "revision_id": payload.revision_uuid,
            "asset_kind": payload.asset_kind.value,
            "attempt": payload.attempt,
            "max_attempts": payload.max_attempts,
            "originating_request_id": payload.originating_request_id,
        }
        operation_logger("playback.started", **context).info("playback.started")

        try:
            with get_worker_db() as db:
                PlaybackGenerationService().render_sync(
                    db,
                    payload.score_uuid,
                    payload.revision_uuid,
                    source_fingerprint=payload.source_fingerprint,
                    asset_kind=payload.asset_kind,
                )
        except Exception as exc:
            record_current_attempt_failure(exc)
            with get_worker_db() as db:
                playback_outbox_service.fail(db, outbox_uuid, str(exc))
                _publish_playback_status(db, payload.score_uuid, payload.revision_uuid, "failed")
            operation_logger(
                "playback.failed",
                **context,
                status="failed",
                exception_type=type(exc).__name__,
            ).opt(exception=True).error("playback.failed")
            return {"status": "failed", "outbox_uuid": outbox_uuid}

        with get_worker_db() as db:
            playback_outbox_service.complete(db, outbox_uuid)
            _publish_playback_status(db, payload.score_uuid, payload.revision_uuid, "ready")
        operation_logger(
            "playback.completed",
            **context,
            status="completed",
        ).info("playback.completed")
        return {"status": "generated", "outbox_uuid": outbox_uuid}
    finally:
        if trace_scope is not None:
            trace_scope.__exit__(*sys.exc_info())
        clear_task_context()


def _publish_playback_status(db: Any, score_uuid: str, revision_uuid: str, status: str) -> None:
    publish_score_event_sync_best_effort(
        db,
        score_id=score_uuid,
        revision_id=revision_uuid,
        type=RealtimeEventTypes.SCORE_DERIVED_ASSET_UPDATED,
        payload={
            "score_id": score_uuid,
            "revision_id": revision_uuid,
            "asset": "audio",
            "status": status,
        },
    )
