"""Storage protocol shared by concrete storage adapters."""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Iterator
from typing import Protocol


class ObjectStorageUnavailableError(RuntimeError):
    """The provider result is unavailable or its side effect is uncertain."""


class ObjectNotFoundError(RuntimeError):
    """The provider definitively reports a missing object or upload handle."""


class ObjectStorageOperationFailedError(RuntimeError):
    """The provider rejects an operation or returns an invalid response."""


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
    etag: str | None = None
    checksum_algorithm: str | None = None
    checksum: str | None = None
    checksum_type: str | None = None


@dataclass(frozen=True)
class UploadedPart:
    part_number: int
    etag: str
    size_bytes: int


@dataclass(frozen=True)
class MultipartUploadResult:
    etag: str | None = None
    checksum_algorithm: str | None = None
    checksum: str | None = None
    checksum_type: str | None = None


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

    def object_metadata(self, key: str) -> ObjectMetadata: ...

    def generate_put_upload_url(
        self,
        key: str,
        *,
        content_type: str,
        content_length: int,
        expires_in: int | None = None,
    ) -> DirectUploadTarget: ...

    def create_multipart_upload(self, key: str, *, content_type: str) -> str: ...

    def generate_part_upload_url(
        self,
        key: str,
        upload_id: str,
        part_number: int,
        *,
        content_length: int,
        expires_in: int | None = None,
    ) -> DirectUploadTarget: ...

    def list_multipart_uploads(self, key: str) -> tuple[str, ...]: ...

    def list_uploaded_parts(self, key: str, upload_id: str) -> tuple[UploadedPart, ...]: ...

    def complete_multipart_upload(
        self, key: str, upload_id: str, parts: tuple[UploadedPart, ...]
    ) -> MultipartUploadResult: ...

    def abort_multipart_upload(self, key: str, upload_id: str) -> None: ...

    def iter_bytes(
        self,
        key: str,
        *,
        chunk_size: int = 1024 * 1024,
        start: int | None = None,
        end: int | None = None,
    ) -> Iterator[bytes]: ...

    def copy(self, source_key: str, target_key: str) -> None: ...

    def delete(self, key: str) -> None: ...

    def download_url(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        expires_seconds: int | None = None,
    ) -> str: ...
