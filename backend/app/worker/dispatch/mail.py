from __future__ import annotations

from uuid import uuid4

from opentelemetry.trace import SpanKind

from app.core.background_tracing import background_attempt_span
from app.core.logger import logger
from app.db.worker_session import get_worker_db
from app.modules.mail.outbox_service import mail_outbox_service
from app.worker.celery_config import celery_app
from app.worker.dispatch.tracing import mail_trace_context


def dispatch_mail_outbox(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with get_worker_db() as db:
        if not mail_outbox_service.mark_dispatched(db, outbox_uuid):
            return False
        trace_context = mail_trace_context(db, outbox_uuid)
    try:
        with background_attempt_span(
            name="noteverse.mail.dispatch",
            traceparent=trace_context.traceparent,
            tracestate=trace_context.tracestate,
            kind=SpanKind.PRODUCER,
            attributes={"noteverse.operation.kind": "mail", "noteverse.operation.id": outbox_uuid},
        ):
            celery_app.send_task(
                "app.worker.tasks.send_mail_outbox_task",
                kwargs={"outbox_uuid": outbox_uuid},
                task_id=task_id,
            )
        logger.bind(
            event="mail.dispatched",
            operation_kind="mail",
            outbox_id=outbox_uuid,
            task_id=task_id,
        ).info("mail.dispatched")
        return True
    except Exception as exc:
        with get_worker_db() as db:
            mail_outbox_service.release_dispatch(db, outbox_uuid, str(exc))
        logger.bind(
            event="mail.dispatch_failed",
            operation_kind="mail",
            outbox_id=outbox_uuid,
            task_id=task_id,
            exception_type=type(exc).__name__,
        ).opt(exception=True).warning("mail.dispatch_failed")
        return False
