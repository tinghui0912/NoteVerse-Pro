"""Attach verified immutable bytes to a semantic owner under the retirement fence."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models.stored_object import StoredObject
from app.modules.storage_objects.facts import StoredObjectFacts
from app.modules.storage_objects.persistence import object_from_row, object_to_row
from app.modules.storage_objects.retirement import retain_for_reference


def adopt_verified_object(db: Session, facts: StoredObjectFacts) -> StoredObject:
    row = db.execute(
        select(StoredObject).where(StoredObject.object_key == facts.object_key)
    ).scalar_one_or_none()
    if row is not None:
        row = retain_for_reference(db, row.id)
        if row is not None:
            if object_from_row(row) != facts:
                raise ValueError("Object adoption disagrees with immutable physical facts")
            return row
    row = object_to_row(facts)
    db.add(row)
    db.flush()
    return row
