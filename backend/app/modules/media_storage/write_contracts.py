"""Immutable server-write commands and generation-bound adoption receipts."""

from dataclasses import dataclass
from app.modules.media_storage.facts import StoredObjectFacts


@dataclass(frozen=True)
class ObjectWriteItem:
    key: str
    content: bytes
    content_type: str = "application/octet-stream"


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
