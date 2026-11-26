"""Immutable, verified durable server-byte facts without product ownership."""

from dataclasses import dataclass
import re
import hashlib


@dataclass(frozen=True)
class StoredObjectFacts:
    object_key: str
    byte_size: int
    sha256: str | None
    content_type: str
    provider_etag: str | None = None
    transport_checksum_algorithm: str | None = None
    transport_checksum: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.object_key, str) or not self.object_key.strip():
            raise ValueError("StoredObject requires a physical locator")
        if "\\" in self.object_key or any(
            part in {"", ".", ".."} for part in self.object_key.split("/")
        ):
            raise ValueError("StoredObject requires a canonical relative object key")
        if type(self.byte_size) is not int or self.byte_size < 0:
            raise ValueError("StoredObject requires nonnegative exact bytes")
        if self.sha256 is not None and (
            not isinstance(self.sha256, str) or re.fullmatch(r"[0-9a-f]{64}", self.sha256) is None
        ):
            raise ValueError("StoredObject requires a full lowercase SHA-256")
        if (self.transport_checksum_algorithm is None) != (self.transport_checksum is None):
            raise ValueError("Transport checksum requires algorithm and value")
        if (
            not isinstance(self.content_type, str)
            or re.fullmatch(r"[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+", self.content_type) is None
        ):
            raise ValueError("StoredObject requires canonical content type")

    def agrees_with(self, other: "StoredObjectFacts") -> bool:
        return (self.object_key, self.byte_size, self.content_type) == (
            other.object_key,
            other.byte_size,
            other.content_type,
        ) and all(
            a is None or b is None or a == b
            for a, b in (
                (self.sha256, other.sha256),
                (self.provider_etag, other.provider_etag),
                (self.transport_checksum_algorithm, other.transport_checksum_algorithm),
                (self.transport_checksum, other.transport_checksum),
            )
        )

    @classmethod
    def from_bytes(
        cls, *, object_key: str, content: bytes, content_type: str
    ) -> "StoredObjectFacts":
        return cls(object_key, len(content), hashlib.sha256(content).hexdigest(), content_type)
