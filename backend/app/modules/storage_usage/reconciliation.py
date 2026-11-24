"""Explicit maintenance of online projections from committed semantic facts."""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.storage_usage import (
    StorageUsageAccount,
    StorageUsageCounter,
    StorageUsageCategory,
)
from app.modules.storage_usage.accounting import new_usage_event
from app.modules.storage_usage.contracts import counts_toward_quota
from app.modules.storage_usage.availability import usage_projection_unavailable
from app.modules.storage_inventory.contracts import StorageInventoryReader
from app.modules.storage_usage.service import StorageUsageService
from app.shared.time import utc_now


@dataclass(frozen=True)
class UsageTotals:
    used_bytes: int


@dataclass(frozen=True)
class CategoryDrift:
    category: StorageUsageCategory
    actual: UsageTotals
    expected: UsageTotals
    counter_exists: bool

    @property
    def drift(self) -> bool:
        return self.actual != self.expected


@dataclass(frozen=True)
class StorageUsageInspection:
    user_id: int
    categories: tuple[CategoryDrift, ...]
    actual_account: UsageTotals
    expected_account: UsageTotals

    @property
    def drift(self) -> bool:
        return self.actual_account != self.expected_account or any(
            item.drift for item in self.categories
        )


class StorageUsageReconciliation:
    def __init__(self, inventory: StorageInventoryReader) -> None:
        self.inventory = inventory
        self.usage = StorageUsageService()

    def _account(self, db: Session, user_id: int, *, lock: bool) -> StorageUsageAccount:
        account = self.usage.repository.account(db, user_id, lock=lock)
        if account is None:
            raise usage_projection_unavailable()
        return account

    def inspect_user(self, db: Session, user_id: int) -> StorageUsageInspection:
        with db.no_autoflush:
            self._account(db, user_id, lock=False)
            return self._inspect(db, user_id)

    def _inspect(self, db: Session, user_id: int) -> StorageUsageInspection:
        used = self.inventory.snapshot_user(db, user_id).used_bytes
        counter = StorageUsageCounter.__table__
        counters = {
            category: UsageTotals(int(used))
            for category, used in db.execute(
                select(counter.c.category, counter.c.used_bytes).where(counter.c.user_id == user_id)
            )
        }
        actual_used = db.execute(
            select(StorageUsageAccount.used_bytes).where(StorageUsageAccount.user_id == user_id)
        ).scalar_one()
        return StorageUsageInspection(
            user_id=user_id,
            categories=tuple(
                CategoryDrift(
                    category,
                    counters[category] if category in counters else UsageTotals(0),
                    UsageTotals(used[category]),
                    category in counters,
                )
                for category in StorageUsageCategory
            ),
            actual_account=UsageTotals(actual_used),
            expected_account=UsageTotals(
                sum(size for category, size in used.items() if counts_toward_quota(category)),
            ),
        )

    def reconcile_user(self, db: Session, user_id: int) -> StorageUsageInspection:
        account = self._account(db, user_id, lock=True)
        # Account serialization precedes inventory reads and counter mutation.
        before = self._inspect(db, user_id)
        for item in before.categories:
            counter = self.usage._ensure_counter(db, user_id, item.category, lock=True)
            if item.actual != item.expected:
                counter.used_bytes = item.expected.used_bytes
                counter.updated_at = utc_now()
            delta = item.expected.used_bytes - item.actual.used_bytes
            if delta:
                db.add(
                    new_usage_event(
                        user_id=user_id,
                        category=item.category,
                        delta_bytes=delta,
                        counts_toward_quota=counts_toward_quota(item.category),
                        reason="reconciliation",
                    )
                )
        if before.actual_account != before.expected_account:
            account.used_bytes = before.expected_account.used_bytes
            account.updated_at = utc_now()
        db.flush()
        return before
