"""Validate provider coverage and combine their database-aggregated contributions."""

from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.modules.storage_governance.inventory.contracts import (
    StorageInventoryProvider,
    StorageInventorySnapshot,
)


class StorageInventoryRegistry:
    def __init__(self, providers: Iterable[StorageInventoryProvider]) -> None:
        self._providers = tuple(
            (provider, frozenset(provider.categories)) for provider in providers
        )
        covered: set[StorageUsageCategory] = set()
        for _, categories in self._providers:
            if not categories or any(not isinstance(c, StorageUsageCategory) for c in categories):
                raise ValueError("Inventory providers must declare valid storage categories")
            covered.update(categories)
        if covered != set(StorageUsageCategory):
            missing = sorted(c.value for c in set(StorageUsageCategory) - covered)
            raise ValueError(f"Missing storage inventory providers for categories: {missing}")

    def snapshot_user(self, db: Session, user_id: int) -> StorageInventorySnapshot:
        totals = dict.fromkeys(StorageUsageCategory, 0)
        with db.no_autoflush:
            for provider, categories in self._providers:
                contribution = provider.used_bytes_for_user(db, user_id)
                if (
                    any(not isinstance(c, StorageUsageCategory) for c in contribution)
                    or set(contribution) != categories
                ):
                    raise ValueError(
                        "Inventory provider must return exactly its declared categories"
                    )
                for category, amount in contribution.items():
                    if type(amount) is not int or amount < 0:
                        raise ValueError("Inventory bytes must be nonnegative integers")
                    totals[category] += amount
        return StorageInventorySnapshot(user_id=user_id, used_bytes=totals)
