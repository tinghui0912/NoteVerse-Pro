from __future__ import annotations

from uuid import uuid4

from opentelemetry.trace import SpanKind

from app.core.background_tracing import background_attempt_span
from app.core.logger import logger
from app.db.worker_session import get_worker_db
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.worker.celery_config import celery_app
from app.worker.dispatch.tracing import render_trace_context


def dispatch_render_outbox(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with get_worker_db() as db:
        if not render_outbox_service.mark_dispatched(db, outbox_uuid):
            return False
        trace_context = render_trace_context(db, outbox_uuid)

    try:
        with background_attempt_span(
            name="noteverse.render.dispatch",
            traceparent=trace_context.traceparent,
            tracestate=trace_context.tracestate,
            kind=SpanKind.PRODUCER,
            attributes={"noteverse.operation.kind": "render", "noteverse.operation.id": outbox_uuid},
        ):
            celery_app.send_task(
                "app.worker.tasks.render_outbox_task",
                kwargs={"outbox_uuid": outbox_uuid},
                task_id=task_id,
            )
        logger.bind(
            event="render.dispatched",
            operation_kind="render",
            outbox_id=outbox_uuid,
            task_id=task_id,
        ).info("render.dispatched")
        return True
    except Exception as exc:
        with get_worker_db() as db:
            render_outbox_service.release_dispatch(db, outbox_uuid, str(exc))
        logger.bind(
            event="render.dispatch_failed",
            operation_kind="render",
            outbox_id=outbox_uuid,
            task_id=task_id,
            exception_type=type(exc).__name__,
        ).opt(exception=True).warning("render.dispatch_failed")
        return False
