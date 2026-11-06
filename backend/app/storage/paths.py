"""Helpers for materializing storage keys to local working paths."""

from __future__ import annotations

from pathlib import Path
from app.core.config import settings
from app.storage import object_storage


def object_work_path(key: str) -> str:
    root = Path(settings.WORK_ROOT).resolve() / "object-cache"
    path = (root / key).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Invalid object key")
    return str(path)


def materialize_storage_key(storage_key: str) -> str:
    """Download or resolve a storage object to a local working path."""

    return object_storage.materialize_to_local(
        storage_key,
        object_work_path(storage_key),
    )
