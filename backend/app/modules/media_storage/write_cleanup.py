"""Fenced physical cleanup and durable delivery of unadopted write generations."""

from uuid import uuid4
from sqlalchemy import select, or_
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.models.object_write_intent import ObjectWriteIntent
from app.modules.media_storage.domain import ObjectWriteIntentStatus
from app.shared.time import utc_now
from dataclasses import dataclass
from app.modules.durable_work.delivery import DeliveryAttemptLease
from app.modules.media_storage.write_lifecycle import cleanup_lifecycle
from app.modules.media_storage.write_intents import lock_intent, intent_facts, _matching_object
from app.storage import ObjectStorage


@dataclass(frozen=True)
class CleanupAttempt(DeliveryAttemptLease):
    intent_uuid: str
    write_token: str


class ObjectWriteCleanupDelivery:
    def claim(self, db: Session, uuid: str) -> CleanupAttempt | None:
        row = lock_intent(db, uuid)
        lease = cleanup_lifecycle().claim(row, token=str(uuid4()), now=utc_now())
        if lease is None:
            return None
        return CleanupAttempt(
            intent_uuid=uuid, write_token=row.write_token, attempt=lease.attempt, token=lease.token
        )

    def dispatch(self, db: Session, uuid: str) -> bool:
        return cleanup_lifecycle().dispatch(lock_intent(db, uuid), now=utc_now())

    def release(self, db: Session, uuid: str, error: str) -> bool:
        return cleanup_lifecycle().release_dispatch(
            lock_intent(db, uuid), error=error, now=utc_now()
        )

    def matches(self, row: ObjectWriteIntent, attempt: CleanupAttempt) -> bool:
        return row.write_token == attempt.write_token and cleanup_lifecycle().attempt_matches(
            row, attempt
        )

    def fail(self, db: Session, attempt: CleanupAttempt, error: str) -> None:
        row = lock_intent(db, attempt.intent_uuid)
        if self.matches(row, attempt):
            cleanup_lifecycle().fail_attempt(row, lease=attempt, error=error, now=utc_now())

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now()
        rows = list(
            db.scalars(
                select(ObjectWriteIntent)
                .where(
                    or_(
                        (
                            ObjectWriteIntent.status.in_(
                                [ObjectWriteIntentStatus.PREPARED, ObjectWriteIntentStatus.WRITTEN]
                            )
                        )
                        & (ObjectWriteIntent.write_expires_at <= now),
                        ObjectWriteIntent.status.in_(
                            [
                                ObjectWriteIntentStatus.CLEANUP_DISPATCHED,
                                ObjectWriteIntentStatus.CLEANUP_PROCESSING,
                            ]
                        ),
                    )
                )
                .with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            )
        )
        lifecycle = cleanup_lifecycle()
        for row in rows:
            if row.status in (ObjectWriteIntentStatus.PREPARED, ObjectWriteIntentStatus.WRITTEN):
                lifecycle.reset(
                    row,
                    status=ObjectWriteIntentStatus.CLEANUP_PENDING,
                    reset_attempts=True,
                    now=now,
                )
            else:
                lifecycle.recover_lease(row, error="Object write cleanup lease expired", now=now)
        db.flush()
        return list(
            db.scalars(
                select(ObjectWriteIntent.intent_uuid)
                .where(
                    ObjectWriteIntent.status.in_(
                        [
                            ObjectWriteIntentStatus.CLEANUP_PENDING,
                            ObjectWriteIntentStatus.CLEANUP_FAILED,
                        ]
                    ),
                    ObjectWriteIntent.next_attempt_at <= now,
                    ObjectWriteIntent.attempt_count < lifecycle.policy.max_attempts,
                )
                .order_by(ObjectWriteIntent.created_at, ObjectWriteIntent.id)
                .limit(settings.OBJECT_WRITE_CLEANUP_DISPATCH_BATCH_SIZE)
            )
        )


write_cleanup_delivery = ObjectWriteCleanupDelivery()


def clean_write_attempt(db: Session, storage: ObjectStorage, attempt: CleanupAttempt) -> str:
    row = lock_intent(db, attempt.intent_uuid)
    if not write_cleanup_delivery.matches(row, attempt):
        return "ignored"
    if _matching_object(db, intent_facts(row)) is not None:
        cleanup_lifecycle().finish_attempt(
            row, lease=attempt, status=ObjectWriteIntentStatus.ADOPTED, error=None, now=utc_now()
        )
        return "adopted"
    storage.delete(row.object_key)
    cleanup_lifecycle().complete_attempt(row, lease=attempt, now=utc_now())
    return "cleaned"
