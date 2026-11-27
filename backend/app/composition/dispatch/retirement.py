"""Durable dispatch uses explicitly supplied database, policy and broker owners."""

from collections.abc import Iterable
from uuid import uuid4
from app.core.logger import logger
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import DurableTraceContext
from celery import Celery
from sqlalchemy.orm import Session, sessionmaker
from app.modules.media_storage.retirement import StoredObjectRetirementDelivery


class StoredObjectRetirementDispatcher:
    def __init__(
        self,
        sessions: sessionmaker[Session],
        delivery: StoredObjectRetirementDelivery,
        sender: Celery,
    ) -> None:
        self.sessions, self.delivery, self.sender = sessions, delivery, sender

    def dispatch_stored_object_retirement(self, retirement_uuid: str) -> bool:
        with self.sessions() as db:
            if not self.delivery.mark_dispatched(db, retirement_uuid):
                db.commit()
                return False
            db.commit()
        return send_durable_task(
            task_name="app.worker.tasks.stored_object_retirement_task",
            task_kwargs={"retirement_uuid": retirement_uuid},
            task_id=uuid4().hex,
            operation_kind="stored_object_retirement",
            operation_id=retirement_uuid,
            span_name="noteverse.stored_object_retirement.dispatch",
            success_event="stored_object_retirement.dispatched",
            failure_event="stored_object_retirement.dispatch_failed",
            log_context={"resource_id": retirement_uuid},
            trace_context=DurableTraceContext(traceparent=None, tracestate=None),
            release_dispatch=lambda error: self._release(retirement_uuid, error),
            sender=self.sender,
        )

    def _release(self, uuid: str, error: str) -> None:
        with self.sessions() as db:
            self.delivery.release_dispatch(db, uuid, error)
            db.commit()

    def dispatch_retirements_best_effort(self, uuids: Iterable[str]) -> None:
        for uuid in set(uuids):
            try:
                self.dispatch_stored_object_retirement(uuid)
            except Exception:
                logger.bind(resource_id=uuid).opt(exception=True).warning(
                    "stored_object_retirement.immediate_dispatch_failed"
                )
