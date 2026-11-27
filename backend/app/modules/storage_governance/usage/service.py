"""Caller-owned logical allocations and strict releases; no capacity admission."""

from types import MappingProxyType
from sqlalchemy.orm import Session
from app.shared.integrity import ResourceIntegrityError
from app.db.models.storage_usage import StorageUsageAccount, StorageUsageCounter
from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.modules.storage_governance.usage.accounting import (
    StorageUsageInvariantError,
    new_usage_event,
    release_used_usage,
)
from app.modules.storage_governance.usage.contracts import StorageUsageSnapshot, counts_toward_quota
from app.modules.storage_governance.usage.availability import usage_projection_unavailable
from app.modules.storage_governance.usage.repository import StorageUsageRepository
from app.shared.time import utc_now


class StorageUsageService:
    def assert_empty_account(self, db: Session, user_id: int) -> None:
        if self.committed_bytes(db, user_id, lock=True) or self.repository.has_nonzero_counters(
            db, user_id
        ):
            raise ResourceIntegrityError("Account erasure found unreleased usage accounting")

    def erase_empty_account_history(self, db: Session, user_id: int, *, limit: int) -> bool:
        self.assert_empty_account(db, user_id)
        return self.repository.erase_user_events(db, user_id, limit=limit)

    def __init__(self, repository: StorageUsageRepository | None = None) -> None:
        self.repository = repository or StorageUsageRepository()

    def committed_bytes(self, db: Session, user_id: int, *, lock: bool = False) -> int:
        return self._require_account(db, user_id, lock=lock).used_bytes

    def try_lock_committed_bytes(self, db: Session, user_id: int) -> int | None:
        account = self.repository.account(db, user_id, lock=True, skip_locked=True)
        if account is None:
            self._require_account(db, user_id, lock=False)
            return None
        return account.used_bytes

    def snapshot_user(self, db: Session, user_id: int) -> StorageUsageSnapshot:
        account = self._require_account(db, user_id, lock=False)
        counters = {row.category: row.used_bytes for row in self.repository.counters(db, user_id)}
        return StorageUsageSnapshot(
            account.used_bytes,
            MappingProxyType(
                {category: counters.get(category, 0) for category in StorageUsageCategory}
            ),
        )

    def record_allocation(
        self,
        db: Session,
        *,
        user_id: int,
        category: StorageUsageCategory,
        bytes_count: int,
        reason: str,
        object_type: str | None = None,
        object_id: str | None = None,
        storage_key: str | None = None,
    ) -> None:
        if type(bytes_count) is not int or bytes_count < 0:
            raise StorageUsageInvariantError("Usage amounts must be nonnegative integer bytes")
        if bytes_count == 0:
            return
        account = self._require_account(db, user_id, lock=True)
        counter = self._ensure_counter(db, user_id, category, lock=True)
        counted = counts_toward_quota(category)
        if counted:
            account.used_bytes += bytes_count
            account.updated_at = utc_now()
        counter.used_bytes += bytes_count
        counter.updated_at = utc_now()
        db.add(
            new_usage_event(
                user_id=user_id,
                category=category,
                delta_bytes=bytes_count,
                counts_toward_quota=counted,
                reason=reason,
                object_type=object_type,
                object_id=object_id,
                storage_key=storage_key,
            )
        )
        db.flush()

    def record_release(
        self,
        db: Session,
        *,
        user_id: int,
        category: StorageUsageCategory,
        bytes_count: int,
        reason: str,
        object_type: str | None = None,
        object_id: str | None = None,
        storage_key: str | None = None,
    ) -> None:
        if type(bytes_count) is not int or bytes_count < 0:
            raise StorageUsageInvariantError("Usage amounts must be nonnegative integer bytes")
        if bytes_count == 0:
            return
        account = self._require_account(db, user_id, lock=True)
        counter = self.repository.counter(db, user_id, category, lock=True)
        if counter is None:
            raise StorageUsageInvariantError("Storage usage release requires an accounted category")
        counts_toward_quota_value = counts_toward_quota(category)
        released = release_used_usage(
            account=account,
            counter=counter,
            bytes_count=bytes_count,
            counts_toward_quota=counts_toward_quota_value,
        )
        db.add(
            new_usage_event(
                user_id=user_id,
                category=category,
                delta_bytes=-released,
                counts_toward_quota=counts_toward_quota_value,
                reason=reason,
                object_type=object_type,
                object_id=object_id,
                storage_key=storage_key,
            )
        )
        db.flush()

    def _require_account(self, db: Session, user_id: int, *, lock: bool) -> StorageUsageAccount:
        account = self.repository.account(db, user_id, lock=lock)
        if account is None:
            raise usage_projection_unavailable()
        return account

    def _ensure_counter(
        self,
        db: Session,
        user_id: int,
        category: StorageUsageCategory,
        *,
        lock: bool,
    ) -> StorageUsageCounter:
        counter = self.repository.counter(db, user_id, category, lock=lock)
        if counter is not None:
            return counter
        counter = StorageUsageCounter(
            user_id=user_id,
            category=category,
            used_bytes=0,
            updated_at=utc_now(),
        )
        db.add(counter)
        db.flush()
        return counter
