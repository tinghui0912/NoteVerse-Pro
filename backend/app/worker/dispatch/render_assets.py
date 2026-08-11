from __future__ import annotations

from uuid import uuid4

from app.db.sync_session import get_worker_db
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.worker.dispatch.runtime import send_durable_task
from app.worker.dispatch.tracing import render_trace_context


def dispatch_render_outbox(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with get_worker_db() as db:
        if not render_outbox_service.mark_dispatched(db, outbox_uuid):
            return False
        trace_context = render_trace_context(db, outbox_uuid)

    return send_durable_task(
        task_name="app.worker.tasks.render_outbox_task",
        task_kwargs={"outbox_uuid": outbox_uuid},
        task_id=task_id,
        operation_kind="render",
        operation_id=outbox_uuid,
        span_name="noteverse.render.dispatch",
        success_event="render.dispatched",
        failure_event="render.dispatch_failed",
        log_context={"outbox_id": outbox_uuid},
        trace_context=trace_context,
        release_dispatch=lambda error: _release_dispatch(outbox_uuid, error),
    )


def _release_dispatch(outbox_uuid: str, error: str) -> None:
    with get_worker_db() as db:
        render_outbox_service.release_dispatch(db, outbox_uuid, error)
