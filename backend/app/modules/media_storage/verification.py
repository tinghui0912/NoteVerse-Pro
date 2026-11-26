"""Database-free streaming integrity observations and fenced digest enrichment."""

from dataclasses import dataclass
from hashlib import sha256
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import StoredObject, StoredObjectRetirement
from app.storage import ObjectStorage
from .facts import StoredObjectFacts
from .persistence import object_from_row


@dataclass(frozen=True)
class VerifiedObjectDigest:
    facts: StoredObjectFacts
    digest: str
    prefix: bytes


class ObjectIntegrityVerifier:
    def __init__(self, storage: ObjectStorage) -> None:
        self.storage = storage

    def verify(self, facts: StoredObjectFacts) -> VerifiedObjectDigest:
        metadata = self.storage.object_metadata(facts.object_key)
        if (
            metadata.size_bytes != facts.byte_size
            or metadata.content_type != facts.content_type
            or facts.provider_etag is not None
            and metadata.etag != facts.provider_etag
        ):
            raise ValueError("Object transport facts changed")
        digest, prefix, size = sha256(), bytearray(), 0
        for chunk in self.storage.iter_bytes(facts.object_key, chunk_size=1024 * 1024):
            size += len(chunk)
            if size > facts.byte_size:
                raise ValueError("Object exceeds admitted byte size")
            digest.update(chunk)
            prefix.extend(chunk[: max(0, 64 - len(prefix))])
        if size != facts.byte_size:
            raise ValueError("Object is incomplete")
        value = digest.hexdigest()
        if facts.sha256 is not None and facts.sha256 != value:
            raise ValueError("Object digest changed")
        return VerifiedObjectDigest(facts, value, bytes(prefix))

    @staticmethod
    def enrich(db: Session, object_id: int, observation: VerifiedObjectDigest) -> None:
        row = db.scalar(select(StoredObject).where(StoredObject.id == object_id).with_for_update())
        fence = db.scalar(
            select(StoredObjectRetirement.deletion_fenced_at).where(
                StoredObjectRetirement.stored_object_id == object_id
            )
        )
        if (
            row is None
            or fence is not None
            or not object_from_row(row).agrees_with(observation.facts)
        ):
            raise ValueError("Object is unavailable for integrity enrichment")
        if row.sha256 is not None and row.sha256 != observation.digest:
            raise ValueError("Committed object digest conflicts with verification")
        row.sha256 = observation.digest
