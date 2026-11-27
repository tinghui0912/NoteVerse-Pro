"""Write-generation row locking, fact checks and transactional intent mutation."""

from datetime import timedelta
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.models.object_write_intent import ObjectWriteIntent
from app.db.models.stored_object import StoredObject
from app.modules.media_storage.domain import ObjectWriteIntentStatus
from app.modules.media_storage.facts import StoredObjectFacts
from app.modules.media_storage.persistence import object_from_row
from app.shared.time import utc_now
from app.modules.media_storage.write_contracts import ObjectWriteReceipt
from app.modules.media_storage.write_lifecycle import cleanup_lifecycle
from app.storage.base import ObjectWriteResult


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


def reserve_intent(db: Session, facts: StoredObjectFacts) -> ObjectWriteIntent:
    if facts.sha256 is None:
        raise ValueError("Server writes require a full digest")
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
    return row


def prepare_write(db: Session, facts: StoredObjectFacts) -> ObjectWriteReceipt:
    row = reserve_intent(db, facts)
    now = utc_now()
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
    db.flush()
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
