"""Durable pre-admission writes. Intent -> StoredObject -> retirement is the lock order.

Preparation/write own their transactions and precede semantic mutation. Adoption never
commits: the caller attaches its owner and commits adoption/accounting together.
Domain parent locks precede intent locks during adoption; prewriting releases read locks.
"""

from app.db.models.object_write_intent import ObjectWriteIntentStatus

from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import select, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models.object_write_intent import ObjectWriteIntent
from app.db.models.stored_object import StoredObject
from app.modules.durable_work.delivery import (
    DurableDeliveryLifecycle,
    DeliveryAttemptLease,
    DeliveryLifecyclePolicy,
    DeliveryStatuses,
)
from app.modules.storage_objects.facts import StoredObjectFacts
from app.modules.storage_objects.persistence import object_from_row, object_to_row
from app.modules.storage_objects.retirement import retain_for_reference
from app.storage.base import ObjectStorage, ObjectWriteResult
from app.shared.time import utc_now


@dataclass(frozen=True)
class ObjectWriteReceipt:
    intent_uuid: str
    write_token: str
    facts: StoredObjectFacts

    @property
    def object_key(self) -> str:
        return self.facts.object_key

    @property
    def size_bytes(self) -> int:
        return self.facts.byte_size


def cleanup_lifecycle() -> DurableDeliveryLifecycle[ObjectWriteIntentStatus]:
    return DurableDeliveryLifecycle(
        DeliveryStatuses(
            ObjectWriteIntentStatus.CLEANUP_PENDING,
            ObjectWriteIntentStatus.CLEANUP_DISPATCHED,
            ObjectWriteIntentStatus.CLEANUP_PROCESSING,
            ObjectWriteIntentStatus.CLEANUP_FAILED,
            ObjectWriteIntentStatus.CLEANED,
        ),
        DeliveryLifecyclePolicy(
            settings.OBJECT_WRITE_CLEANUP_MAX_ATTEMPTS,
            settings.OBJECT_WRITE_CLEANUP_RETRY_BASE_SECONDS,
            settings.OBJECT_WRITE_CLEANUP_DISPATCH_TIMEOUT_SECONDS,
            settings.OBJECT_WRITE_CLEANUP_PROCESSING_TIMEOUT_SECONDS,
        ),
    )


def intent_facts(row: ObjectWriteIntent) -> StoredObjectFacts:
    return StoredObjectFacts(row.object_key, row.byte_size, row.sha256, row.content_type)


def lock_intent(db: Session, intent_uuid: str) -> ObjectWriteIntent:
    row = db.scalar(
        select(ObjectWriteIntent)
        .where(ObjectWriteIntent.intent_uuid == intent_uuid)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise ValueError("Object write intent is missing")
    return row


def _matching_object(db: Session, facts: StoredObjectFacts) -> StoredObject | None:
    row = db.scalar(
        select(StoredObject)
        .where(StoredObject.object_key == facts.object_key)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is not None and object_from_row(row) != facts:
        raise ValueError("Object write facts conflict with committed object")
    return row


def prepare_write(db: Session, facts: StoredObjectFacts) -> ObjectWriteReceipt:
    now = utc_now()
    row = db.scalar(
        select(ObjectWriteIntent)
        .where(ObjectWriteIntent.object_key == facts.object_key)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None:
        try:
            with db.begin_nested():
                row = ObjectWriteIntent(
                    object_key=facts.object_key,
                    byte_size=facts.byte_size,
                    sha256=facts.sha256,
                    content_type=facts.content_type,
                    write_token=str(uuid4()),
                    write_expires_at=now
                    + timedelta(seconds=settings.OBJECT_WRITE_INTENT_LEASE_SECONDS),
                )
                db.add(row)
                db.flush()
        except IntegrityError:
            row = db.scalar(
                select(ObjectWriteIntent)
                .where(ObjectWriteIntent.object_key == facts.object_key)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if row is None:
                raise
    if intent_facts(row) != facts:
        raise ValueError("Immutable object key has conflicting write facts")
    existing = _matching_object(db, facts)
    if existing is None and row.status in (
        ObjectWriteIntentStatus.ADOPTED,
        ObjectWriteIntentStatus.CLEANED,
    ):
        cleanup_lifecycle().reset(
            row, status=ObjectWriteIntentStatus.PREPARED, reset_attempts=True, now=now
        )
        row.write_token = str(uuid4())
        row.written_at = None
        row.write_expires_at = now + timedelta(seconds=settings.OBJECT_WRITE_INTENT_LEASE_SECONDS)
    elif row.status not in (
        ObjectWriteIntentStatus.PREPARED,
        ObjectWriteIntentStatus.WRITTEN,
        ObjectWriteIntentStatus.ADOPTED,
    ):
        raise ValueError("Object write cleanup owns this generation")
    elif row.write_expires_at <= now and row.status != ObjectWriteIntentStatus.ADOPTED:
        # No physical IO is in flight while this row lock is held. A new writer
        # owns a fresh generation; earlier callers cannot adopt or write it.
        row.write_token = str(uuid4())
        row.status = ObjectWriteIntentStatus.PREPARED
        row.written_at = None
        row.write_expires_at = now + timedelta(seconds=settings.OBJECT_WRITE_INTENT_LEASE_SECONDS)
        row.updated_at = now
    receipt = ObjectWriteReceipt(row.intent_uuid, row.write_token, facts)
    db.commit()  # PREPARED is durable before any physical mutation.
    return receipt


def require_generation(row: ObjectWriteIntent, receipt: ObjectWriteReceipt) -> None:
    if row.write_token != receipt.write_token or intent_facts(row) != receipt.facts:
        raise ValueError("Stale object write generation")


def inspect_write(
    db: Session, receipt: ObjectWriteReceipt, content: bytes
) -> tuple[ObjectWriteIntent, bool]:
    """Lock and validate exact generation/facts before either physical IO scheduler."""
    row = lock_intent(db, receipt.intent_uuid)
    require_generation(row, receipt)
    if (
        StoredObjectFacts.from_bytes(
            object_key=receipt.object_key, content=content, content_type=receipt.facts.content_type
        )
        != receipt.facts
    ):
        raise ValueError("Write bytes disagree with intent")
    existing = _matching_object(db, receipt.facts)
    if existing is not None and row.status in (
        ObjectWriteIntentStatus.PREPARED,
        ObjectWriteIntentStatus.WRITTEN,
        ObjectWriteIntentStatus.ADOPTED,
    ):
        cleanup_lifecycle().finish(
            row, status=ObjectWriteIntentStatus.ADOPTED, error=None, now=utc_now()
        )
        return row, False
    if (
        row.status not in (ObjectWriteIntentStatus.PREPARED, ObjectWriteIntentStatus.WRITTEN)
        or row.write_expires_at <= utc_now()
    ):
        raise ValueError("Object write lease is not active")
    return row, row.status == ObjectWriteIntentStatus.PREPARED and existing is None


def finalize_write(
    row: ObjectWriteIntent, receipt: ObjectWriteReceipt, result: ObjectWriteResult | None
) -> None:
    require_generation(row, receipt)
    if result is not None and (
        result.object_key != receipt.object_key or result.size_bytes != receipt.facts.byte_size
    ):
        raise ValueError("Object write result disagrees with intent")
    if row.status != ObjectWriteIntentStatus.ADOPTED:
        row.status = ObjectWriteIntentStatus.WRITTEN
        row.written_at = row.written_at or utc_now()
        row.updated_at = utc_now()


def perform_write(
    db: Session, storage: ObjectStorage, receipt: ObjectWriteReceipt, content: bytes
) -> None:
    row, needs_put = inspect_write(db, receipt, content)
    result = (
        storage.put_bytes(
            key=receipt.object_key, content=content, content_type=receipt.facts.content_type
        )
        if needs_put
        else None
    )
    finalize_write(row, receipt, result)
    db.commit()  # The exact intent lock covers physical put and WRITTEN persistence.


def prepare_object_write(
    db: Session, *, key: str, content: bytes, content_type: str
) -> ObjectWriteReceipt:
    if db.new or db.dirty or db.deleted:
        raise ValueError("Prewrite requires a clean semantic transaction")
    return prepare_write(
        db, StoredObjectFacts.from_bytes(object_key=key, content=content, content_type=content_type)
    )


def write_object(
    db: Session,
    storage: ObjectStorage,
    *,
    key: str,
    content: bytes,
    content_type: str = "application/octet-stream",
) -> ObjectWriteReceipt:
    try:
        receipt = prepare_object_write(db, key=key, content=content, content_type=content_type)
        perform_write(db, storage, receipt, content)
        return receipt
    except BaseException:
        db.rollback()
        raise


def retain_existing_object(db: Session, facts: StoredObjectFacts) -> StoredObject | None:
    """No creation and no speculative retention: caller attaches an owner in this transaction."""
    intent = db.scalar(
        select(ObjectWriteIntent)
        .where(ObjectWriteIntent.object_key == facts.object_key)
        .with_for_update()
    )
    if intent is not None and intent_facts(intent) != facts:
        raise ValueError("Object intent disagrees with retained facts")
    row = _matching_object(db, facts)
    return retain_for_reference(db, row.id) if row is not None else None


def adopt_written_object(db: Session, receipt: ObjectWriteReceipt) -> StoredObject:
    row = lock_intent(db, receipt.intent_uuid)
    require_generation(row, receipt)
    existing = _matching_object(db, receipt.facts)
    if row.status == ObjectWriteIntentStatus.ADOPTED and existing is not None:
        retained = retain_existing_object(db, receipt.facts)
        if retained is None:
            raise ValueError("Committed object retired during attachment")
        return retained
    if row.status != ObjectWriteIntentStatus.WRITTEN or row.write_expires_at <= utc_now():
        raise ValueError("New StoredObject requires a live WRITTEN intent")
    if existing is None:
        existing = object_to_row(receipt.facts)
        db.add(existing)
        db.flush()
    else:
        existing = retain_for_reference(db, existing.id)
        if existing is None:
            raise ValueError("Committed object retired during adoption")
    cleanup_lifecycle().finish(
        row, status=ObjectWriteIntentStatus.ADOPTED, error=None, now=utc_now()
    )
    return existing


def receipt_for_intent(db: Session, intent_uuid: str) -> ObjectWriteReceipt:
    row = lock_intent(db, intent_uuid)
    return ObjectWriteReceipt(row.intent_uuid, row.write_token, intent_facts(row))


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
