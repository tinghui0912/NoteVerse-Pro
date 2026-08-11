from __future__ import annotations

from dataclasses import dataclass

from app.db.models import StorageUsageCategory


@dataclass(frozen=True)
class StorageUsageReleaseRecord:
    category: StorageUsageCategory
    bytes_count: int
    object_type: str
    object_id: str
    storage_key: str
    delete_storage: bool = False
