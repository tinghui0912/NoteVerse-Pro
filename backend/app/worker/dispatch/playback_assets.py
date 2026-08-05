from __future__ import annotations

from uuid import uuid4

from opentelemetry.trace import SpanKind

from app.core.background_tracing import background_attempt_span
from app.core.logger import logger
from app.db.worker_session import get_worker_db
from app.modules.playback.outbox_service import playback_outbox_service
from app.worker.celery_config import celery_app
from app.worker.dispatch.tracing import playback_trace_context


def dispatch_playback_outbox(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with get_worker_db() as db:
        if not playback_outbox_service.mark_dispatched(db, outbox_uuid):
            return False
        trace_context = playback_trace_context(db, outbox_uuid)

    try:
        with background_attempt_span(
            name="noteverse.playback.dispatch",
            traceparent=trace_context.traceparent,
            tracestate=trace_context.tracestate,
            kind=SpanKind.PRODUCER,
            attributes={"noteverse.operation.kind": "playback", "noteverse.operation.id": outbox_uuid},
        ):
            celery_app.send_task(
                "app.worker.tasks.playback_outbox_task",
                kwargs={"outbox_uuid": outbox_uuid},
                task_id=task_id,
            )
        logger.bind(
            event="playback.dispatched",
            operation_kind="playback",
            outbox_id=outbox_uuid,
            task_id=task_id,
        ).info("playback.dispatched")
        return True
    except Exception as exc:
        with get_worker_db() as db:
            playback_outbox_service.release_dispatch(db, outbox_uuid, str(exc))
        logger.bind(
            event="playback.dispatch_failed",
            operation_kind="playback",
            outbox_id=outbox_uuid,
            task_id=task_id,
            exception_type=type(exc).__name__,
        ).opt(exception=True).warning("playback.dispatch_failed")
        return False
