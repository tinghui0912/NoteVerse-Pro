"""Immutable, verified durable server-byte facts without product ownership."""

from dataclasses import dataclass
import re
import hashlib


@dataclass(frozen=True)
class StoredObjectFacts:
    object_key: str
    byte_size: int
    sha256: str
    content_type: str

    def __post_init__(self) -> None:
        if not isinstance(self.object_key, str) or not self.object_key.strip():
            raise ValueError("StoredObject requires a physical locator")
        if type(self.byte_size) is not int or self.byte_size < 0:
            raise ValueError("StoredObject requires nonnegative exact bytes")
        if not isinstance(self.sha256, str) or re.fullmatch(r"[0-9a-f]{64}", self.sha256) is None:
            raise ValueError("StoredObject requires a full lowercase SHA-256")
        if (
            not isinstance(self.content_type, str)
            or re.fullmatch(r"[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+", self.content_type) is None
        ):
            raise ValueError("StoredObject requires canonical content type")

    @classmethod
    def from_bytes(
        cls, *, object_key: str, content: bytes, content_type: str
    ) -> "StoredObjectFacts":
        return cls(object_key, len(content), hashlib.sha256(content).hexdigest(), content_type)
