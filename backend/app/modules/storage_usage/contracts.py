"""Logical usage projection read/locking contract consumed by capacity admission."""

from dataclasses import dataclass
from typing import Mapping, Protocol
from sqlalchemy.orm import Session
from app.db.models.storage_usage import StorageUsageCategory

QUOTA_CATEGORIES = frozenset(
    {StorageUsageCategory.SOURCE, StorageUsageCategory.UPLOAD, StorageUsageCategory.INPUT_ASSET}
)


def counts_toward_quota(category: StorageUsageCategory) -> bool:
    return category in QUOTA_CATEGORIES


@dataclass(frozen=True)
class StorageUsageSnapshot:
    used_bytes: int
    categories: Mapping[StorageUsageCategory, int]


class StorageUsageReader(Protocol):
    def committed_bytes(self, db: Session, user_id: int, *, lock: bool = False) -> int: ...
    def snapshot_user(self, db: Session, user_id: int) -> StorageUsageSnapshot: ...
