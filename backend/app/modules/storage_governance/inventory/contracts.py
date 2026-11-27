"""Read-only aggregated inventory; semantic allocation multiplicity is preserved."""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Protocol

from sqlalchemy.orm import Session

from app.modules.storage_governance.usage.domain import StorageUsageCategory


@dataclass(frozen=True)
class StorageInventorySnapshot:
    user_id: int
    used_bytes: Mapping[StorageUsageCategory, int]

    def __post_init__(self) -> None:
        object.__setattr__(self, "used_bytes", MappingProxyType(dict(self.used_bytes)))


class StorageInventoryProvider(Protocol):
    """Own a disjoint semantic resource set, returning all declared categories.

    Aggregate in SQL, include explicit zeros, and never commit, flush caller writes,
    or query an object-storage provider. Physical deduplication does not deduplicate
    semantic allocations. Contributions to a shared category are added by Registry.
    """

    @property
    def categories(self) -> frozenset[StorageUsageCategory]: ...

    def used_bytes_for_user(
        self, db: Session, user_id: int
    ) -> Mapping[StorageUsageCategory, int]: ...


class StorageInventoryReader(Protocol):
    """Consumer port for a complete, validated and immutable user inventory."""

    def snapshot_user(self, db: Session, user_id: int) -> StorageInventorySnapshot: ...
