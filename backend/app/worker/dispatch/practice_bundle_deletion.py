from __future__ import annotations

from uuid import uuid4

from app.db.sync_session import get_worker_db
from app.modules.practice.bundle.retention import (
    practice_bundle_delete_service,
)
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import DurableTraceContext


def dispatch_practice_bundle_deletion(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with get_worker_db() as db:
        if not practice_bundle_delete_service.mark_dispatched(db, outbox_uuid):
            return False

    return send_durable_task(
        task_name="app.worker.tasks.practice_bundle_deletion_task",
        task_kwargs={"outbox_uuid": outbox_uuid},
        task_id=task_id,
        operation_kind="practice_bundle_deletion",
        operation_id=outbox_uuid,
        span_name="noteverse.practice_bundle_deletion.dispatch",
        success_event="practice_bundle_deletion.dispatched",
        failure_event="practice_bundle_deletion.dispatch_failed",
        log_context={"outbox_id": outbox_uuid},
        trace_context=DurableTraceContext(traceparent=None, tracestate=None),
        release_dispatch=lambda error: _release_dispatch(outbox_uuid, error),
    )


def _release_dispatch(outbox_uuid: str, error: str) -> None:
    with get_worker_db() as db:
        practice_bundle_delete_service.release_dispatch(db, outbox_uuid, error)
