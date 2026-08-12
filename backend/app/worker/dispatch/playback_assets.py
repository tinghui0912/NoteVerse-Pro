from __future__ import annotations

from uuid import uuid4

from app.db.sync_session import get_worker_db
from app.modules.playback.outbox_service import playback_outbox_service
from app.worker.dispatch.runtime import send_durable_task
from app.worker.dispatch.tracing import playback_trace_context


def dispatch_playback_outbox(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with get_worker_db() as db:
        if not playback_outbox_service.mark_dispatched(db, outbox_uuid):
            return False
        trace_context = playback_trace_context(db, outbox_uuid)

    return send_durable_task(
        task_name="app.worker.tasks.playback_outbox_task",
        task_kwargs={"outbox_uuid": outbox_uuid},
        task_id=task_id,
        operation_kind="playback",
        operation_id=outbox_uuid,
        span_name="noteverse.playback.dispatch",
        success_event="playback.dispatched",
        failure_event="playback.dispatch_failed",
        log_context={"outbox_id": outbox_uuid},
        trace_context=trace_context,
        release_dispatch=lambda error: _release_dispatch(outbox_uuid, error),
    )


def _release_dispatch(outbox_uuid: str, error: str) -> None:
    with get_worker_db() as db:
        playback_outbox_service.release_dispatch(db, outbox_uuid, error)
