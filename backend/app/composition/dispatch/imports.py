"""Durable dispatch uses explicitly supplied database, policy and broker owners."""

from __future__ import annotations


from uuid import uuid4
from app.core.logger import logger
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import import_dispatch_trace_context
from celery import Celery
from sqlalchemy.orm import Session, sessionmaker
from app.modules.import_jobs.dispatch_service import ImportDispatchService


class ImportDispatcher:
    def __init__(
        self, sessions: sessionmaker[Session], delivery: ImportDispatchService, sender: Celery
    ) -> None:
        self.sessions, self.delivery, self.sender = sessions, delivery, sender

    def dispatch_import_dispatch(self, dispatch_uuid: str) -> bool:
        task_id = uuid4().hex
        try:
            with self.sessions() as db:
                if not self.delivery.mark_dispatched(db, dispatch_uuid):
                    db.commit()
                    return False
                trace_context = import_dispatch_trace_context(db, dispatch_uuid)
                db.commit()
            return send_durable_task(
                task_name="app.worker.tasks.import_dispatch_task",
                task_kwargs={"dispatch_uuid": dispatch_uuid},
                task_id=task_id,
                operation_kind="import",
                operation_id=dispatch_uuid,
                span_name="noteverse.import.dispatch",
                success_event="import.dispatched",
                failure_event="import.dispatch_failed",
                log_context={"operation_id": dispatch_uuid},
                trace_context=trace_context,
                release_dispatch=lambda error: self._release_dispatch(dispatch_uuid, error),
                sender=self.sender,
            )
        except Exception as exc:
            self._release_dispatch(dispatch_uuid, str(exc))
            logger.bind(
                event="import.dispatch_failed",
                operation_kind="import",
                operation_id=dispatch_uuid,
                task_id=task_id,
                exception_type=type(exc).__name__,
            ).opt(exception=True).warning("import.dispatch_failed")
            return False

    def _release_dispatch(self, dispatch_uuid: str, error: str) -> None:
        with self.sessions() as db:
            self.delivery.release_dispatch(db, dispatch_uuid, error)
            db.commit()
