"""Local filesystem storage implementation.

This keeps storage-path knowledge out of feature services. Object storage
adapters expose the same operations and return local working paths only when a
worker needs to process bytes.
"""

from __future__ import annotations

import glob
import os
import shutil

from app.core.config import settings
from app.storage.base import StoredFile


class LocalFileStorage:
    """Filesystem-backed storage for development and single-node deployments."""

    backend_name = "local"
    score_prefix = "scores"
    avatar_prefix = "avatars"

    def __init__(self, storage_root: str | None = None) -> None:
        self._storage_root = storage_root

    @property
    def storage_root(self) -> str:
        return self._storage_root or settings.STORAGE_ROOT

    @property
    def score_root(self) -> str:
        return os.path.join(self.storage_root, self.score_prefix)

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

    def delete(self, key: str) -> bool:
        path = self.local_path(key)
        if not os.path.exists(path):
            return False
        os.remove(path)
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

    def save_score_upload(
        self,
        *,
        content: bytes,
        sha256: str,
        extension: str,
    ) -> StoredFile:
        """Store uploaded score bytes by content hash."""

        os.makedirs(self.score_root, exist_ok=True)
        existing = self.find_score_upload(sha256)
        if existing:
            return existing

        filename = f"{sha256}{extension}"
        return self.put_bytes(
            key=f"{self.score_prefix}/{filename}",
            content=content,
        )

    def find_score_upload(self, sha256: str) -> StoredFile | None:
        """Find a previously stored score upload by content hash."""

        candidates = glob.glob(os.path.join(self.score_root, f"{sha256}.*"))
        if not candidates:
            return None

        path = os.path.abspath(candidates[0])
        return self._stored_file(
            f"{self.score_prefix}/{os.path.basename(path)}",
            path,
        )

    def resolve_score_uploads(self, file_ids: list[str]) -> list[str]:
        """Resolve score upload ids to absolute local paths."""

        paths: list[str] = []
        for file_id in file_ids:
            stored = self.find_score_upload(file_id)
            if not stored:
                raise FileNotFoundError(file_id)
            paths.append(os.path.abspath(stored.path))
        return paths

    def score_upload_path(self, filename: str) -> str:
        """Return the absolute path for a stored score upload filename."""

        return self.local_path(f"{self.score_prefix}/{filename}")

    def score_upload_exists(self, filename: str) -> bool:
        return self.exists(f"{self.score_prefix}/{filename}")

    def delete_score_upload(self, filename: str) -> bool:
        """Delete a score upload if present."""

        return self.delete(f"{self.score_prefix}/{filename}")

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


file_storage = LocalFileStorage()
