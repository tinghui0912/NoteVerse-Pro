"""Transactional reference release/retention and durable physical retirement delivery."""

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models.stored_object import StoredObject
from app.db.models.stored_object_retirement import StoredObjectRetirement
from app.modules.durable_work.delivery import (
    DeliveryLifecyclePolicy,
    DeliveryStatuses,
    DurableDeliveryLifecycle,
    DeliveryAttemptLease,
)
from app.modules.storage_objects.persistence import object_from_row
from app.modules.storage_objects.facts import StoredObjectFacts
from app.modules.storage_objects.references import stored_object_has_semantic_references
from app.shared.time import utc_now


def delivery_lifecycle() -> DurableDeliveryLifecycle[str]:
    return DurableDeliveryLifecycle(
        DeliveryStatuses("PENDING", "DISPATCHED", "PROCESSING", "FAILED", "COMPLETED"),
        DeliveryLifecyclePolicy(
            settings.STORED_OBJECT_RETIREMENT_MAX_ATTEMPTS,
            settings.STORED_OBJECT_RETIREMENT_RETRY_BASE_SECONDS,
            settings.STORED_OBJECT_RETIREMENT_DISPATCH_TIMEOUT_SECONDS,
            settings.STORED_OBJECT_RETIREMENT_PROCESSING_TIMEOUT_SECONDS,
        ),
    )


def _object(db: Session, object_id: int) -> StoredObject | None:
    return db.execute(
        select(StoredObject)
        .where(StoredObject.id == object_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def _operation_for_object(db: Session, object_id: int) -> StoredObjectRetirement | None:
    return db.execute(
        select(StoredObjectRetirement)
        .where(StoredObjectRetirement.stored_object_id == object_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def retain_for_reference(db: Session, object_id: int) -> StoredObject | None:
    """Store row precedes operation row in every lock-bearing acquisition/destruction."""
    row = _object(db, object_id)
    if row is None:
        return None
    operation = _operation_for_object(db, object_id)
    if operation is not None:
        if operation.status == "COMPLETED":
            raise ValueError("Completed retirement still references a physical object")
        delivery_lifecycle().finish(operation, status="CANCELLED", error=None, now=utc_now())
    return row


def retire_if_unreferenced(db: Session, object_id: int) -> StoredObjectRetirement | None:
    """Caller flushes reference removal; caller owns commit. No storage IO occurs here."""
    row = _object(db, object_id)
    if row is None or stored_object_has_semantic_references(db, object_id):
        return None
    facts = object_from_row(row)
    operation = _operation_for_object(db, object_id)
    if operation is None:
        operation = StoredObjectRetirement(
            stored_object_id=object_id,
            object_key=facts.object_key,
            byte_size=facts.byte_size,
            sha256=facts.sha256,
            content_type=facts.content_type,
        )
        db.add(operation)
        db.flush()
    elif operation.status == "CANCELLED":
        if snapshot(operation) != facts:
            raise ValueError("Retirement snapshot disagrees with StoredObject")
        delivery_lifecycle().rearm(operation, now=utc_now())
    return operation


def retire_after_release(db: Session, *object_ids: int) -> list[str]:
    db.flush()
    operations = [retire_if_unreferenced(db, object_id) for object_id in sorted(set(object_ids))]
    return [operation.retirement_uuid for operation in operations if operation is not None]


def snapshot(operation: StoredObjectRetirement) -> StoredObjectFacts:
    return StoredObjectFacts(
        operation.object_key, operation.byte_size, operation.sha256, operation.content_type
    )


@dataclass(frozen=True)
class RetirementAttempt(DeliveryAttemptLease):
    retirement_uuid: str
    stored_object_id: int | None


class StoredObjectRetirementDelivery:
    @staticmethod
    def get(db: Session, uuid: str, *, lock: bool = False) -> StoredObjectRetirement | None:
        statement = select(StoredObjectRetirement).where(
            StoredObjectRetirement.retirement_uuid == uuid
        )
        if lock:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return db.execute(statement).scalar_one_or_none()

    def claim(self, db: Session, uuid: str) -> RetirementAttempt | None:
        row = self.get(db, uuid, lock=True)
        if row is None:
            return None
        lease = delivery_lifecycle().claim(row, token=str(uuid4()), now=utc_now())
        if lease is None:
            return None
        return RetirementAttempt(
            retirement_uuid=row.retirement_uuid,
            stored_object_id=row.stored_object_id,
            attempt=lease.attempt,
            token=lease.token,
        )

    def mark_dispatched(self, db: Session, uuid: str) -> bool:
        row = self.get(db, uuid, lock=True)
        return row is not None and delivery_lifecycle().dispatch(row, now=utc_now())

    def release_dispatch(self, db: Session, uuid: str, error: str) -> None:
        row = self.get(db, uuid, lock=True)
        if row is not None:
            delivery_lifecycle().release_dispatch(row, error=error, now=utc_now())

    def fail(self, db: Session, attempt: RetirementAttempt, error: str) -> bool:
        row = self.get(db, attempt.retirement_uuid, lock=True)
        return row is not None and delivery_lifecycle().fail_attempt(
            row, lease=attempt, error=error, now=utc_now()
        )

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now()
        lifecycle = delivery_lifecycle()
        rows = list(
            db.scalars(
                select(StoredObjectRetirement)
                .where(StoredObjectRetirement.status.in_(["DISPATCHED", "PROCESSING"]))
                .with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            )
        )
        for row in rows:
            lifecycle.recover_lease(row, error="StoredObject retirement lease expired", now=now)
        db.flush()
        return list(
            db.scalars(
                select(StoredObjectRetirement.retirement_uuid)
                .where(
                    StoredObjectRetirement.status.in_(["PENDING", "FAILED"]),
                    StoredObjectRetirement.next_attempt_at <= now,
                    StoredObjectRetirement.attempt_count < lifecycle.policy.max_attempts,
                )
                .order_by(StoredObjectRetirement.created_at, StoredObjectRetirement.id)
                .limit(settings.STORED_OBJECT_RETIREMENT_DISPATCH_BATCH_SIZE)
            )
        )


retirement_delivery = StoredObjectRetirementDelivery()
