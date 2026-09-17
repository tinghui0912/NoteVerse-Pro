from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    PracticeReplayObjectDeletionOutbox,
    PracticeReplayObjectDeletionStatus,
)
from app.modules.async_operations.delivery_policy import (
    delivery_lease_expired,
    exponential_retry_delay_seconds,
)
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class PracticeReplayObjectDeletionPayload:
    outbox_uuid: str
    storage_backend: str
    object_key: str
    attempt: int
    max_attempts: int


class PracticeReplayObjectDeletionOutboxService:
    def claim(
        self,
        db: Session,
        outbox_uuid: str,
    ) -> PracticeReplayObjectDeletionPayload | None:
        outbox = db.execute(
            select(PracticeReplayObjectDeletionOutbox)
            .where(PracticeReplayObjectDeletionOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
        ).scalar_one_or_none()
        if outbox is None or outbox.status in {
            PracticeReplayObjectDeletionStatus.PROCESSING,
            PracticeReplayObjectDeletionStatus.COMPLETED,
        }:
            return None
        if (
            outbox.status == PracticeReplayObjectDeletionStatus.FAILED
            and outbox.next_attempt_at > utc_now_naive()
        ):
            return None
        if outbox.attempt_count >= settings.PRACTICE_REPLAY_DELETE_OUTBOX_MAX_ATTEMPTS:
            return None

        attempt = outbox.attempt_count + 1
        payload = replace(
            self._build_payload(outbox),
            attempt=attempt,
            max_attempts=settings.PRACTICE_REPLAY_DELETE_OUTBOX_MAX_ATTEMPTS,
        )
        now = utc_now_naive()
        outbox.status = PracticeReplayObjectDeletionStatus.PROCESSING
        outbox.attempt_count += 1
        outbox.started_at = now
        outbox.updated_at = now
        return payload

    def _build_payload(
        self,
        outbox: PracticeReplayObjectDeletionOutbox,
    ) -> PracticeReplayObjectDeletionPayload:
        return PracticeReplayObjectDeletionPayload(
            outbox_uuid=outbox.outbox_uuid,
            storage_backend=outbox.storage_backend,
            object_key=outbox.object_key,
            attempt=0,
            max_attempts=settings.PRACTICE_REPLAY_DELETE_OUTBOX_MAX_ATTEMPTS,
        )

    def complete(self, db: Session, outbox_uuid: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        now = utc_now_naive()
        outbox.status = PracticeReplayObjectDeletionStatus.COMPLETED
        outbox.completed_at = now
        outbox.last_error = None
        outbox.updated_at = now

    def fail(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        now = utc_now_naive()
        delay = exponential_retry_delay_seconds(
            base_seconds=settings.PRACTICE_REPLAY_DELETE_OUTBOX_RETRY_BASE_SECONDS,
            attempt_count=outbox.attempt_count,
        )
        outbox.status = PracticeReplayObjectDeletionStatus.FAILED
        outbox.next_attempt_at = now + timedelta(seconds=delay)
        outbox.last_error = error[:4000]
        outbox.updated_at = now

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not self._is_dispatchable(outbox):
            return False
        now = utc_now_naive()
        outbox.status = PracticeReplayObjectDeletionStatus.DISPATCHED
        outbox.dispatched_at = now
        outbox.updated_at = now
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or outbox.status != PracticeReplayObjectDeletionStatus.DISPATCHED:
            return
        outbox.status = PracticeReplayObjectDeletionStatus.PENDING
        outbox.dispatched_at = None
        outbox.last_error = error[:4000]
        outbox.updated_at = utc_now_naive()

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        stale = db.execute(
            select(PracticeReplayObjectDeletionOutbox).where(
                or_(
                    PracticeReplayObjectDeletionOutbox.status
                    == PracticeReplayObjectDeletionStatus.DISPATCHED,
                    PracticeReplayObjectDeletionOutbox.status
                    == PracticeReplayObjectDeletionStatus.PROCESSING,
                )
            )
        ).scalars()
        for outbox in stale:
            if delivery_lease_expired(
                status=outbox.status,
                dispatched_status=PracticeReplayObjectDeletionStatus.DISPATCHED,
                processing_status=PracticeReplayObjectDeletionStatus.PROCESSING,
                dispatched_at=outbox.dispatched_at,
                started_at=outbox.started_at,
                now=now,
                dispatch_timeout_seconds=(
                    settings.PRACTICE_REPLAY_DELETE_OUTBOX_DISPATCH_TIMEOUT_SECONDS
                ),
                processing_timeout_seconds=(
                    settings.PRACTICE_REPLAY_DELETE_OUTBOX_PROCESSING_TIMEOUT_SECONDS
                ),
            ):
                outbox.status = PracticeReplayObjectDeletionStatus.FAILED
                outbox.next_attempt_at = now
                outbox.last_error = "Practice replay object deletion lease expired"
                outbox.updated_at = now

        due = db.execute(
            select(PracticeReplayObjectDeletionOutbox.outbox_uuid)
            .where(
                PracticeReplayObjectDeletionOutbox.status.in_(
                    [
                        PracticeReplayObjectDeletionStatus.PENDING,
                        PracticeReplayObjectDeletionStatus.FAILED,
                    ]
                ),
                PracticeReplayObjectDeletionOutbox.next_attempt_at <= now,
                PracticeReplayObjectDeletionOutbox.attempt_count
                < settings.PRACTICE_REPLAY_DELETE_OUTBOX_MAX_ATTEMPTS,
            )
            .order_by(PracticeReplayObjectDeletionOutbox.created_at)
            .limit(settings.PRACTICE_REPLAY_DELETE_OUTBOX_DISPATCH_BATCH_SIZE)
        )
        return list(due.scalars())

    @staticmethod
    def _get(
        db: Session,
        outbox_uuid: str,
    ) -> PracticeReplayObjectDeletionOutbox | None:
        return db.execute(
            select(PracticeReplayObjectDeletionOutbox).where(
                PracticeReplayObjectDeletionOutbox.outbox_uuid == outbox_uuid
            )
        ).scalar_one_or_none()

    @staticmethod
    def _is_dispatchable(outbox: PracticeReplayObjectDeletionOutbox) -> bool:
        return (
            outbox.status
            in {
                PracticeReplayObjectDeletionStatus.PENDING,
                PracticeReplayObjectDeletionStatus.FAILED,
            }
            and outbox.attempt_count
            < settings.PRACTICE_REPLAY_DELETE_OUTBOX_MAX_ATTEMPTS
            and outbox.next_attempt_at <= utc_now_naive()
        )


practice_replay_object_deletion_outbox_service = (
    PracticeReplayObjectDeletionOutboxService()
)
