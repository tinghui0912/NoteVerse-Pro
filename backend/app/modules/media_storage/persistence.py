"""Single hydration boundary for immutable durable byte observations."""

from app.db.models.stored_object import StoredObject
from .facts import StoredObjectFacts


def object_from_row(row: StoredObject) -> StoredObjectFacts:
    return StoredObjectFacts(row.object_key, row.byte_size, row.sha256, row.content_type)


def object_to_row(value: StoredObjectFacts) -> StoredObject:
    return StoredObject(
        object_key=value.object_key,
        byte_size=value.byte_size,
        sha256=value.sha256,
        content_type=value.content_type,
    )


def object_from_bytes(*, object_key: str, content: bytes, content_type: str) -> StoredObject:
    return object_to_row(
        StoredObjectFacts.from_bytes(
            object_key=object_key, content=content, content_type=content_type
        )
    )
