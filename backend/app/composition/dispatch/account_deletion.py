"""Durable dispatch uses explicitly supplied database, policy and broker owners."""

from uuid import uuid4
from app.core.logger import logger
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import DurableTraceContext
from celery import Celery
from sqlalchemy.orm import Session, sessionmaker
from app.modules.account.deletion_delivery import AccountDeletionDelivery


class AccountDeletionDispatcher:
    def __init__(
        self, sessions: sessionmaker[Session], delivery: AccountDeletionDelivery, sender: Celery
    ) -> None:
        self.sessions, self.delivery, self.sender = sessions, delivery, sender

    def _release(self, uuid: str, error: str) -> None:
        with self.sessions.begin() as db:
            self.delivery.release_dispatch(db, uuid, error)

    def dispatch_account_deletion(self, uuid: str) -> bool:
        with self.sessions.begin() as db:
            if not self.delivery.dispatch(db, uuid):
                return False
        return send_durable_task(
            task_name="app.worker.tasks.account_deletion_task",
            task_kwargs={"operation_uuid": uuid},
            task_id=uuid4().hex,
            operation_kind="account_deletion",
            operation_id=uuid,
            span_name="noteverse.account_deletion.dispatch",
            success_event="account_deletion.dispatched",
            failure_event="account_deletion.dispatch_failed",
            log_context={"operation_id": uuid},
            trace_context=DurableTraceContext(None, None),
            release_dispatch=lambda error: self._release(uuid, error),
            sender=self.sender,
        )

    def dispatch_account_deletion_best_effort(self, uuid: str) -> None:
        try:
            self.dispatch_account_deletion(uuid)
        except Exception:
            logger.bind(operation_id=uuid).opt(exception=True).warning(
                "account_deletion.immediate_dispatch_failed"
            )
