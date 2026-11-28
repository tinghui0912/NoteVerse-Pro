"""Durable dispatch uses explicitly supplied database, policy and broker owners."""

from __future__ import annotations


from uuid import uuid4
from sqlalchemy import select
from app.db.models import PlaybackOutbox
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import playback_trace_context
from celery import Celery
from sqlalchemy.orm import Session, sessionmaker
from app.modules.playback.outbox_service import PlaybackOutboxService


class PlaybackDispatcher:
    def __init__(
        self, sessions: sessionmaker[Session], delivery: PlaybackOutboxService, sender: Celery
    ) -> None:
        self.sessions, self.delivery, self.sender = sessions, delivery, sender

    def dispatch_playback_outbox(self, outbox_uuid: str) -> bool:
        task_id = uuid4().hex
        with self.sessions() as db:
            if not self.delivery.mark_dispatched(db, outbox_uuid):
                db.commit()
                return False
            trace_context = playback_trace_context(db, outbox_uuid)
            owner = db.execute(
                select(PlaybackOutbox.score_id, PlaybackOutbox.revision_id).where(
                    PlaybackOutbox.outbox_uuid == outbox_uuid
                )
            ).one()
            db.commit()
        return send_durable_task(
            task_name="app.worker.tasks.playback_outbox_task",
            task_kwargs={"outbox_uuid": outbox_uuid},
            task_id=task_id,
            operation_kind="playback",
            operation_id=outbox_uuid,
            span_name="noteverse.playback.dispatch",
            success_event="playback.dispatched",
            failure_event="playback.dispatch_failed",
            log_context={
                "outbox_id": outbox_uuid,
                "score_id": owner.score_id,
                "revision_id": owner.revision_id,
            },
            trace_context=trace_context,
            release_dispatch=lambda error: self._release_playback_dispatch(outbox_uuid, error),
            sender=self.sender,
        )

    def _release_playback_dispatch(self, outbox_uuid: str, error: str) -> None:
        with self.sessions() as db:
            self.delivery.release_dispatch(db, outbox_uuid, error)
            db.commit()
