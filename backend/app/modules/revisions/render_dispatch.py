"""Durable render dispatch and broker-failure release."""

from uuid import uuid4
from sqlalchemy import select
from app.db.models import ScoreRevisionRenderOutbox
from app.db.session import SessionLocal
from app.modules.revisions.render_delivery import revision_render_delivery
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import revision_render_trace_context


def dispatch_score_revision_render(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with SessionLocal() as db:
        if not revision_render_delivery.mark_dispatched(db, outbox_uuid):
            db.commit()
            return False
        trace_context = revision_render_trace_context(db, outbox_uuid)
        owner = db.execute(
            select(ScoreRevisionRenderOutbox.score_id, ScoreRevisionRenderOutbox.revision_id).where(
                ScoreRevisionRenderOutbox.outbox_uuid == outbox_uuid
            )
        ).one()
        db.commit()

    return send_durable_task(
        task_name="app.worker.tasks.score_revision_render_task",
        task_kwargs={"outbox_uuid": outbox_uuid},
        task_id=task_id,
        operation_kind="revision_render",
        operation_id=outbox_uuid,
        span_name="noteverse.revision_render.dispatch",
        success_event="revision_render.dispatched",
        failure_event="revision_render.dispatch_failed",
        log_context={
            "outbox_id": outbox_uuid,
            "score_id": owner.score_id,
            "revision_id": owner.revision_id,
        },
        trace_context=trace_context,
        release_dispatch=lambda error: _release_revision_render_dispatch(outbox_uuid, error),
    )


def _release_revision_render_dispatch(outbox_uuid: str, error: str) -> None:
    with SessionLocal() as db:
        revision_render_delivery.release_dispatch(db, outbox_uuid, error)
        db.commit()
