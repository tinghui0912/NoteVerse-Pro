"""Storage adapter factory."""

from __future__ import annotations

from functools import lru_cache

from app.core.config import settings
from app.storage.base import FileStorage
from app.storage.local import LocalFileStorage


@lru_cache(maxsize=1)
def get_file_storage() -> FileStorage:
    """Return the configured storage adapter."""

    if settings.FILE_STORAGE_BACKEND == "local":
        return LocalFileStorage()
    if settings.FILE_STORAGE_BACKEND == "s3":
        from app.storage.s3 import S3CompatibleStorage

        return S3CompatibleStorage()
    raise ValueError(f"Unsupported FILE_STORAGE_BACKEND: {settings.FILE_STORAGE_BACKEND}")


file_storage = get_file_storage()
