"""Explicit maintenance of online projections from committed semantic and hold facts."""

from dataclasses import dataclass

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.db.models import (
    StorageUsageAccount,
    StorageUsageCounter,
    StorageUsageCategory,
    StorageUsageReservation,
    StorageUsageReservationStatus,
)
from app.modules.storage_usage.accounting import counts_toward_quota, new_usage_event
from app.modules.storage_usage.entitlements import quota_check_unavailable
from app.modules.storage_usage.inventory import semantic_used_bytes
from app.modules.storage_usage.service import StorageUsageService
from app.shared.time import utc_now


@dataclass(frozen=True)
class UsageTotals:
    used_bytes: int
    reserved_bytes: int


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
    def __init__(self) -> None:
        self.usage = StorageUsageService()

    def _account(self, db: Session, user_id: int, *, lock: bool) -> StorageUsageAccount:
        account = self.usage.repository.account(db, user_id, lock=lock)
        if account is None:
            raise quota_check_unavailable("storage_usage_account")
        # Provisioning and entitlement remain explicit authorities. Never create them here.
        self.usage._effective_entitlement(db, user_id, lock=False)
        return account

    def inspect_user(self, db: Session, user_id: int) -> StorageUsageInspection:
        with db.no_autoflush:
            self._account(db, user_id, lock=False)
            return self._inspect(db, user_id)

    def _inspect(self, db: Session, user_id: int) -> StorageUsageInspection:
        used = semantic_used_bytes(db, user_id)
        reservation = StorageUsageReservation.__table__
        holds = db.execute(
            select(
                reservation.c.category,
                reservation.c.counts_toward_quota_snapshot,
                func.sum(reservation.c.bytes_reserved),
            )
            .where(
                reservation.c.user_id == user_id,
                reservation.c.status == StorageUsageReservationStatus.RESERVED,
            )
            .group_by(reservation.c.category, reservation.c.counts_toward_quota_snapshot)
        ).all()
        reserved = {category: 0 for category in StorageUsageCategory}
        quota_reserved = 0
        for category, counted, total in holds:
            reserved[category] += int(total)
            if counted:
                quota_reserved += int(total)
        counter = StorageUsageCounter.__table__
        counters = {
            category: UsageTotals(int(used), int(held))
            for category, used, held in db.execute(
                select(counter.c.category, counter.c.used_bytes, counter.c.reserved_bytes).where(
                    counter.c.user_id == user_id
                )
            )
        }
        actual_used, actual_reserved = db.execute(
            select(StorageUsageAccount.used_bytes, StorageUsageAccount.reserved_bytes).where(
                StorageUsageAccount.user_id == user_id
            )
        ).one()
        return StorageUsageInspection(
            user_id=user_id,
            categories=tuple(
                CategoryDrift(
                    category,
                    counters[category] if category in counters else UsageTotals(0, 0),
                    UsageTotals(used[category], reserved[category]),
                    category in counters,
                )
                for category in StorageUsageCategory
            ),
            actual_account=UsageTotals(actual_used, actual_reserved),
            expected_account=UsageTotals(
                sum(size for category, size in used.items() if counts_toward_quota(category)),
                quota_reserved,
            ),
        )

    def reconcile_user(self, db: Session, user_id: int) -> StorageUsageInspection:
        account = self._account(db, user_id, lock=True)
        # Account serialization precedes inventory reads and counter mutation. No owner,
        # reservation or entitlement row is locked after this lock.
        before = self._inspect(db, user_id)
        for item in before.categories:
            counter = self.usage._ensure_counter(db, user_id, item.category, lock=True)
            if item.actual != item.expected:
                counter.used_bytes = item.expected.used_bytes
                counter.reserved_bytes = item.expected.reserved_bytes
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
            account.reserved_bytes = before.expected_account.reserved_bytes
            account.updated_at = utc_now()
        db.flush()
        return before
