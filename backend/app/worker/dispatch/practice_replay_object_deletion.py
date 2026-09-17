from __future__ import annotations

from uuid import uuid4

from app.db.sync_session import get_worker_db
from app.modules.practice.replay_object_deletion_outbox_service import (
    practice_replay_object_deletion_outbox_service,
)
from app.worker.dispatch.runtime import send_durable_task
from app.worker.dispatch.tracing import DurableTraceContext


def dispatch_practice_replay_object_deletion(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with get_worker_db() as db:
        if not practice_replay_object_deletion_outbox_service.mark_dispatched(
            db,
            outbox_uuid,
        ):
            return False

    return send_durable_task(
        task_name="app.worker.tasks.practice_replay_object_deletion_task",
        task_kwargs={"outbox_uuid": outbox_uuid},
        task_id=task_id,
        operation_kind="practice_replay_object_deletion",
        operation_id=outbox_uuid,
        span_name="noteverse.practice_replay_object_deletion.dispatch",
        success_event="practice_replay_object_deletion.dispatched",
        failure_event="practice_replay_object_deletion.dispatch_failed",
        log_context={"outbox_id": outbox_uuid},
        trace_context=DurableTraceContext(traceparent=None, tracestate=None),
        release_dispatch=lambda error: _release_dispatch(outbox_uuid, error),
    )


def _release_dispatch(outbox_uuid: str, error: str) -> None:
    with get_worker_db() as db:
        practice_replay_object_deletion_outbox_service.release_dispatch(
            db,
            outbox_uuid,
            error,
        )
