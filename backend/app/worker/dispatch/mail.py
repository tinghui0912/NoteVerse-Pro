from __future__ import annotations

from uuid import uuid4

from app.db.sync_session import get_worker_db
from app.modules.mail.outbox_service import mail_outbox_service
from app.worker.dispatch.runtime import send_durable_task
from app.worker.dispatch.tracing import mail_trace_context


def dispatch_mail_outbox(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with get_worker_db() as db:
        if not mail_outbox_service.mark_dispatched(db, outbox_uuid):
            return False
        trace_context = mail_trace_context(db, outbox_uuid)
    return send_durable_task(
        task_name="app.worker.tasks.send_mail_outbox_task",
        task_kwargs={"outbox_uuid": outbox_uuid},
        task_id=task_id,
        operation_kind="mail",
        operation_id=outbox_uuid,
        span_name="noteverse.mail.dispatch",
        success_event="mail.dispatched",
        failure_event="mail.dispatch_failed",
        log_context={"outbox_id": outbox_uuid},
        trace_context=trace_context,
        release_dispatch=lambda error: _release_dispatch(outbox_uuid, error),
    )


def _release_dispatch(outbox_uuid: str, error: str) -> None:
    with get_worker_db() as db:
        mail_outbox_service.release_dispatch(db, outbox_uuid, error)
