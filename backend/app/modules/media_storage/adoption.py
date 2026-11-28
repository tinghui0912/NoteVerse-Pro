"""Caller-owned atomic admission and retention of formal physical objects."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models.object_write_intent import ObjectWriteIntent
from app.db.models.stored_object import StoredObject
from app.modules.media_storage.domain import ObjectWriteIntentStatus
from app.modules.media_storage.facts import StoredObjectFacts
from app.modules.media_storage.persistence import object_to_row
from app.shared.time import utc_now
from collections.abc import Sequence
from app.modules.media_storage.write_contracts import ObjectWriteReceipt
from app.modules.media_storage.write_intents import (
    lock_intent,
    require_generation,
    intent_facts,
    _matching_object,
)
from app.modules.media_storage.write_lifecycle import cleanup_transitions
from app.modules.media_storage.retirement import retain_for_reference


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
    cleanup_transitions().finish(
        row, status=ObjectWriteIntentStatus.ADOPTED, error=None, now=utc_now()
    )
    return existing


def receipt_for_intent(db: Session, intent_uuid: str) -> ObjectWriteReceipt:
    row = lock_intent(db, intent_uuid)
    return ObjectWriteReceipt(row.intent_uuid, row.write_token, intent_facts(row))


def adopt_written_objects(
    db: Session, receipts: Sequence[ObjectWriteReceipt]
) -> tuple[StoredObject, ...]:
    ordered = sorted(receipts, key=lambda receipt: receipt.object_key)
    for receipt in ordered:
        require_generation(lock_intent(db, receipt.intent_uuid), receipt)
    objects = {receipt.intent_uuid: adopt_written_object(db, receipt) for receipt in ordered}
    return tuple(objects[receipt.intent_uuid] for receipt in receipts)
