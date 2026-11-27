"""Revision metadata broker relay; durable admission is already committed."""

from uuid import uuid4
from app.db.session import SessionLocal
from app.modules.revisions.metadata_delivery import metadata_delivery
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import DurableTraceContext


def dispatch_revision_metadata(outbox_uuid: str) -> bool:
    with SessionLocal() as db:
        if not metadata_delivery.mark_dispatched(db, outbox_uuid):
            db.commit()
            return False
        row = metadata_delivery.get(db, outbox_uuid)
        assert row is not None
        trace = DurableTraceContext(row.traceparent, row.tracestate)
        db.commit()
    return send_durable_task(
        task_name="app.worker.tasks.revision_metadata_task",
        task_kwargs={"outbox_uuid": outbox_uuid},
        task_id=uuid4().hex,
        operation_kind="revision_metadata",
        operation_id=outbox_uuid,
        span_name="noteverse.revision_metadata.dispatch",
        success_event="revision_metadata.dispatched",
        failure_event="revision_metadata.dispatch_failed",
        log_context={"outbox_id": outbox_uuid},
        trace_context=trace,
        release_dispatch=lambda error: release(outbox_uuid, error),
    )


def release(uuid: str, error: str) -> None:
    with SessionLocal() as db:
        metadata_delivery.release_dispatch(db, uuid, error)
        db.commit()
