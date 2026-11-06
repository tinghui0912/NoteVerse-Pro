"""Storage protocol shared by concrete storage adapters."""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Iterator
from typing import Protocol


@dataclass(frozen=True)
class ObjectWriteResult:
    """Observed identity and byte size of an object write."""

    object_key: str
    size_bytes: int


@dataclass(frozen=True)
class DirectUploadTarget:
    """A short-lived object upload target issued by the storage adapter."""

    upload_url: str
    upload_method: str
    upload_headers: dict[str, str]


@dataclass(frozen=True)
class ObjectMetadata:
    """Metadata read from an existing storage object."""

    size_bytes: int
    content_type: str | None = None
    checksum_sha256: str | None = None


class ObjectStorage(Protocol):
    """Operations required by feature services and workers."""

    def put_bytes(
        self,
        *,
        key: str,
        content: bytes,
        content_type: str | None = None,
    ) -> ObjectWriteResult: ...

    def exists(self, key: str) -> bool: ...

    def read_bytes(self, key: str) -> bytes: ...

    def size_bytes(self, key: str) -> int: ...

    def object_metadata(self, key: str) -> ObjectMetadata: ...

    def upload_url(
        self,
        key: str,
        *,
        content_type: str,
        checksum_sha256: str,
    ) -> DirectUploadTarget: ...

    def iter_bytes(
        self,
        key: str,
        *,
        chunk_size: int = 1024 * 1024,
        start: int | None = None,
        end: int | None = None,
    ) -> Iterator[bytes]: ...

    def copy(self, source_key: str, target_key: str) -> None: ...

    def delete(self, key: str) -> bool: ...

    def download_url(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        expires_seconds: int | None = None,
    ) -> str: ...

    def materialize_to_local(self, key: str, target_path: str) -> str: ...
