"""Durable dispatch uses explicitly supplied database, policy and broker owners."""

from __future__ import annotations


from uuid import uuid4
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import mail_trace_context
from celery import Celery
from sqlalchemy.orm import Session, sessionmaker
from app.modules.mail.outbox_service import MailOutboxService


class MailDispatcher:
    def __init__(
        self, sessions: sessionmaker[Session], delivery: MailOutboxService, sender: Celery
    ) -> None:
        self.sessions, self.delivery, self.sender = sessions, delivery, sender

    def dispatch_mail_outbox(self, outbox_uuid: str) -> bool:
        task_id = uuid4().hex
        with self.sessions() as db:
            if not self.delivery.mark_dispatched(db, outbox_uuid):
                db.commit()
                return False
            trace_context = mail_trace_context(db, outbox_uuid)
            db.commit()
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
            release_dispatch=lambda error: self._release_dispatch(outbox_uuid, error),
            sender=self.sender,
        )

    def _release_dispatch(self, outbox_uuid: str, error: str) -> None:
        with self.sessions() as db:
            self.delivery.release_dispatch(db, outbox_uuid, error)
            db.commit()
