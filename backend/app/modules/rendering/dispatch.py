"""Durable render dispatch and broker-failure release."""

from uuid import uuid4
from sqlalchemy import select
from app.db.models import RenderOutbox
from app.db.session import SessionLocal
from app.modules.rendering.delivery import render_outbox_service
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import render_trace_context


def dispatch_render_outbox(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with SessionLocal() as db:
        if not render_outbox_service.mark_dispatched(db, outbox_uuid):
            db.commit()
            return False
        trace_context = render_trace_context(db, outbox_uuid)
        owner = db.execute(
            select(RenderOutbox.score_id, RenderOutbox.revision_id).where(
                RenderOutbox.outbox_uuid == outbox_uuid
            )
        ).one()
        db.commit()

    return send_durable_task(
        task_name="app.worker.tasks.render_outbox_task",
        task_kwargs={"outbox_uuid": outbox_uuid},
        task_id=task_id,
        operation_kind="render",
        operation_id=outbox_uuid,
        span_name="noteverse.render.dispatch",
        success_event="render.dispatched",
        failure_event="render.dispatch_failed",
        log_context={
            "outbox_id": outbox_uuid,
            "score_id": owner.score_id,
            "revision_id": owner.revision_id,
        },
        trace_context=trace_context,
        release_dispatch=lambda error: _release_render_dispatch(outbox_uuid, error),
    )


def _release_render_dispatch(outbox_uuid: str, error: str) -> None:
    with SessionLocal() as db:
        render_outbox_service.release_dispatch(db, outbox_uuid, error)
        db.commit()
