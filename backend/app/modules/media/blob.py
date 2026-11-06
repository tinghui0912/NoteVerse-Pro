"""Immutable, verified durable server-byte facts without product ownership."""

from dataclasses import dataclass
import re


@dataclass(frozen=True)
class MediaBlobFacts:
    object_key: str
    byte_size: int
    sha256: str
    content_type: str

    def __post_init__(self) -> None:
        if any(not isinstance(value, str) or not value.strip() for value in (self.object_key,)):
            raise ValueError("MediaBlob requires a physical locator")
        if type(self.byte_size) is not int or self.byte_size <= 0:
            raise ValueError("MediaBlob requires positive exact bytes")
        if not isinstance(self.sha256, str) or re.fullmatch(r"[0-9a-f]{64}", self.sha256) is None:
            raise ValueError("MediaBlob requires a full lowercase SHA-256")
        if (
            not isinstance(self.content_type, str)
            or re.fullmatch(r"[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+", self.content_type) is None
        ):
            raise ValueError("MediaBlob requires canonical content type")
