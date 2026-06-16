"""Helpers for materializing storage keys to local working paths."""

from __future__ import annotations

from app.storage import file_storage


def materialize_storage_key(storage_key: str) -> str:
    """Download or resolve a storage object to a local working path."""

    return file_storage.materialize_to_local(
        storage_key,
        file_storage.local_path(storage_key),
    )

