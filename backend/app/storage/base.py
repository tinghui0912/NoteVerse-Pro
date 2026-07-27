"""Storage protocol shared by concrete storage adapters."""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Iterator
from typing import Protocol


@dataclass(frozen=True)
class StoredFile:
    """Metadata for a file stored by the storage adapter."""

    storage_key: str
    filename: str
    path: str
    size_bytes: int
    public_url: str | None = None


class FileStorage(Protocol):
    """Operations required by feature services and workers."""

    backend_name: str

    def put_bytes(
        self,
        *,
        key: str,
        content: bytes,
        content_type: str | None = None,
    ) -> StoredFile:
        ...

    def exists(self, key: str) -> bool:
        ...

    def read_bytes(self, key: str) -> bytes:
        ...

    def size_bytes(self, key: str) -> int:
        ...

    def iter_bytes(
        self,
        key: str,
        *,
        chunk_size: int = 1024 * 1024,
        start: int | None = None,
        end: int | None = None,
    ) -> Iterator[bytes]:
        ...

    def delete(self, key: str) -> bool:
        ...

    def local_path(self, key: str) -> str:
        ...

    def public_url(self, key: str) -> str:
        ...

    def download_url(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> str | None:
        ...

    def materialize_to_local(self, key: str, target_path: str) -> str:
        ...

    def save_blob(
        self,
        *,
        content: bytes,
        sha256: str,
        extension: str,
        content_type: str | None = None,
    ) -> StoredFile:
        ...

    def save_avatar(
        self,
        *,
        content: bytes,
        filename: str,
    ) -> StoredFile:
        ...

    def avatar_url(self, filename: str) -> str:
        ...

    def delete_avatar(self, filename: str) -> bool:
        ...
