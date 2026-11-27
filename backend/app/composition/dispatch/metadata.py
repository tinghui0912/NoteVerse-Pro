"""Durable dispatch uses explicitly supplied database, policy and broker owners."""

from uuid import uuid4
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import DurableTraceContext
from celery import Celery
from sqlalchemy.orm import Session, sessionmaker
from app.modules.revisions.metadata_delivery import RevisionMetadataDelivery


class RevisionMetadataDispatcher:
    def __init__(
        self, sessions: sessionmaker[Session], delivery: RevisionMetadataDelivery, sender: Celery
    ) -> None:
        self.sessions, self.delivery, self.sender = sessions, delivery, sender

    def dispatch_revision_metadata(self, outbox_uuid: str) -> bool:
        with self.sessions() as db:
            if not self.delivery.mark_dispatched(db, outbox_uuid):
                db.commit()
                return False
            row = self.delivery.get(db, outbox_uuid)
            assert row is not None
            trace = DurableTraceContext(row.traceparent, row.tracestate)
            db.commit()
        return send_durable_task(
            task_name="app.worker.tasks.revision_metadata_task",
            task_kwargs={"outbox_uuid": outbox_uuid},
            task_id=uuid4().hex,
            operation_kind="revision_metadata",
            operation_id=outbox_uuid,
            span_name="noteverse.revision_metadata.dispatch",
            success_event="revision_metadata.dispatched",
            failure_event="revision_metadata.dispatch_failed",
            log_context={"outbox_id": outbox_uuid},
            trace_context=trace,
            release_dispatch=lambda error: self.release(outbox_uuid, error),
            sender=self.sender,
        )

    def release(self, uuid: str, error: str) -> None:
        with self.sessions() as db:
            self.delivery.release_dispatch(db, uuid, error)
            db.commit()
