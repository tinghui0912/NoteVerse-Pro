"""Local filesystem storage implementation.

This keeps storage-path knowledge out of feature services. Object storage
adapters expose the same operations and return local working paths only when a
worker needs to process bytes.
"""

from __future__ import annotations

import os
import shutil

from app.core.config import settings
from app.storage.base import StoredFile


class LocalFileStorage:
    """Filesystem-backed storage for development and single-node deployments."""

    backend_name = "local"
    score_prefix = "scores"
    blob_prefix = "blobs"
    avatar_prefix = "avatars"

    def __init__(self, storage_root: str | None = None) -> None:
        self._storage_root = storage_root

    @property
    def storage_root(self) -> str:
        return self._storage_root or settings.STORAGE_ROOT

    def put_bytes(
        self,
        *,
        key: str,
        content: bytes,
        content_type: str | None = None,
    ) -> StoredFile:
        """Store bytes under a storage-relative object key."""

        path = self.local_path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as file_handle:
            file_handle.write(content)

        return self._stored_file(key, path)

    def exists(self, key: str) -> bool:
        return os.path.exists(self.local_path(key))

    def read_bytes(self, key: str) -> bytes:
        with open(self.local_path(key), "rb") as file_handle:
            return file_handle.read()

    def delete(self, key: str) -> bool:
        path = self.local_path(key)
        if not os.path.exists(path):
            return False
        os.remove(path)
        self._remove_empty_parents(os.path.dirname(path))
        return True

    def local_path(self, key: str) -> str:
        """Return a safe absolute local path for a storage key."""

        normalized_key = self._normalize_key(key)
        root = os.path.abspath(self.storage_root)
        path = os.path.abspath(os.path.join(root, normalized_key))
        if os.path.commonpath([root, path]) != root:
            raise ValueError(f"Storage key escapes storage root: {key}")
        return path

    def public_url(self, key: str) -> str:
        normalized_key = self._normalize_key(key)
        return f"{settings.API_V1_STR}/uploads/{normalized_key}"

    def download_url(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> str | None:
        return None

    def materialize_to_local(self, key: str, target_path: str) -> str:
        source_path = self.local_path(key)
        if not os.path.exists(source_path):
            raise FileNotFoundError(key)

        target_abs = os.path.abspath(target_path)
        os.makedirs(os.path.dirname(target_abs), exist_ok=True)
        if os.path.abspath(source_path) != target_abs:
            shutil.copyfile(source_path, target_abs)
        return target_abs

    def save_blob(
        self,
        *,
        content: bytes,
        sha256: str,
        extension: str,
        content_type: str | None = None,
    ) -> StoredFile:
        """Store globally deduplicated bytes by content hash."""

        filename = f"{sha256}{extension}"
        prefix = sha256[:2]
        key = f"{self.blob_prefix}/{prefix}/{filename}"
        if self.exists(key):
            return self._stored_file(key, self.local_path(key))
        return self.put_bytes(
            key=key,
            content=content,
            content_type=content_type,
        )

    def save_avatar(
        self,
        *,
        content: bytes,
        filename: str,
    ) -> StoredFile:
        """Store a processed avatar image."""

        return self.put_bytes(
            key=f"{self.avatar_prefix}/{filename}",
            content=content,
            content_type="image/jpeg",
        )

    def avatar_url(self, filename: str) -> str:
        return self.public_url(f"{self.avatar_prefix}/{filename}")

    def delete_avatar(self, filename: str) -> bool:
        return self.delete(f"{self.avatar_prefix}/{filename}")

    def _stored_file(self, key: str, path: str) -> StoredFile:
        normalized_key = self._normalize_key(key)
        return StoredFile(
            storage_key=normalized_key,
            filename=os.path.basename(normalized_key),
            path=os.path.abspath(path),
            size_bytes=os.path.getsize(path),
            public_url=self.public_url(normalized_key),
        )

    @staticmethod
    def _normalize_key(key: str) -> str:
        normalized = key.replace("\\", "/").strip("/")
        if not normalized or normalized.startswith("../") or "/../" in normalized:
            raise ValueError(f"Invalid storage key: {key}")
        return normalized

    def _remove_empty_parents(self, start_dir: str) -> None:
        root = os.path.abspath(self.storage_root)
        current = os.path.abspath(start_dir)
        while os.path.commonpath([root, current]) == root and current != root:
            try:
                os.rmdir(current)
            except OSError:
                return
            current = os.path.dirname(current)


file_storage = LocalFileStorage()
