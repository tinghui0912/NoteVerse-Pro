"""Durable dispatch uses explicitly supplied database, policy and broker owners."""

from collections.abc import Iterable
from uuid import uuid4
from app.core.logger import logger
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import DurableTraceContext
from celery import Celery
from sqlalchemy.orm import Session, sessionmaker
from app.modules.media_storage.write_cleanup import ObjectWriteCleanupDelivery


class ObjectWriteCleanupDispatcher:
    def __init__(
        self, sessions: sessionmaker[Session], delivery: ObjectWriteCleanupDelivery, sender: Celery
    ) -> None:
        self.sessions, self.delivery, self.sender = sessions, delivery, sender

    def dispatch_object_write_cleanup(self, intent_uuid: str) -> bool:
        with self.sessions() as db:
            if not self.delivery.dispatch(db, intent_uuid):
                db.commit()
                return False
            db.commit()
        return send_durable_task(
            task_name="app.worker.tasks.object_write_cleanup_task",
            task_kwargs={"intent_uuid": intent_uuid},
            task_id=uuid4().hex,
            operation_kind="object_write_cleanup",
            operation_id=intent_uuid,
            span_name="noteverse.object_write_cleanup.dispatch",
            success_event="object_write_cleanup.dispatched",
            failure_event="object_write_cleanup.dispatch_failed",
            log_context={"resource_id": intent_uuid},
            trace_context=DurableTraceContext(traceparent=None, tracestate=None),
            release_dispatch=lambda error: self._release(intent_uuid, error),
            sender=self.sender,
        )

    def _release(self, uuid: str, error: str) -> None:
        with self.sessions() as db:
            self.delivery.release(db, uuid, error)
            db.commit()

    def dispatch_write_cleanups_best_effort(self, uuids: Iterable[str]) -> None:
        for uuid in set(uuids):
            try:
                self.dispatch_object_write_cleanup(uuid)
            except Exception:
                logger.bind(resource_id=uuid).opt(exception=True).warning(
                    "object_write_cleanup.immediate_dispatch_failed"
                )
