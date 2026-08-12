from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.models import (
    StorageQuotaPolicy,
    StorageUsageAccount,
    StorageUsageCategory,
    StorageUsageCounter,
    StorageUsageReservationStatus,
)
from app.modules.storage_usage.accounting import (
    DEFAULT_PLAN_CODE,
    apply_reservation_hold,
    commit_reserved_usage,
    counts_toward_quota,
    new_reservation,
    new_usage_event,
    release_reserved_usage,
    release_used_usage,
)
from app.modules.storage_usage.repository import StorageUsageRepository
from app.modules.storage_usage.schemas import (
    StorageUsageBreakdownRead,
    StorageUsageQuotaRead,
    StorageUsageRead,
)
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class StorageReservationHandle:
    reservation_id: str
    bytes_reserved: int


class StorageUsageService:
    def __init__(self, repository: StorageUsageRepository | None = None) -> None:
        self.repository = repository or StorageUsageRepository()

    async def get_usage(self, db: AsyncSession, user_id: int) -> StorageUsageRead:
        account = await self._ensure_account(db, user_id, lock=False)
        counters = {counter.category: counter for counter in await self.repository.counters(db, user_id)}
        breakdown = [
            StorageUsageBreakdownRead(
                category=category,
                used_bytes=counters[category].used_bytes if category in counters else 0,
                reserved_bytes=counters[category].reserved_bytes if category in counters else 0,
                counts_toward_quota=counts_toward_quota(category),
            )
            for category in StorageUsageCategory
        ]
        return StorageUsageRead(
            quota=StorageUsageQuotaRead(
                used_bytes=account.used_bytes,
                reserved_bytes=account.reserved_bytes,
                limit_bytes=account.quota_limit_bytes,
                available_bytes=max(
                    account.quota_limit_bytes - account.used_bytes - account.reserved_bytes,
                    0,
                ),
            ),
            breakdown=breakdown,
        )

    async def reserve(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        category: StorageUsageCategory,
        bytes_count: int,
        reason: str,
        object_type: str | None = None,
        object_id: str | None = None,
        storage_key: str | None = None,
    ) -> StorageReservationHandle:
        if bytes_count <= 0:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="bytes_count",
                details={"bytes_count": bytes_count},
            )
        account = await self._ensure_account(db, user_id, lock=True)
        counter = await self._ensure_counter(db, user_id, category, lock=True)
        counts_toward_quota_value = counts_toward_quota(category)
        apply_reservation_hold(
            account=account,
            counter=counter,
            bytes_count=bytes_count,
            counts_toward_quota=counts_toward_quota_value,
        )
        reservation = new_reservation(
            user_id=user_id,
            category=category,
            bytes_count=bytes_count,
            counts_toward_quota=counts_toward_quota_value,
            reason=reason,
            object_type=object_type,
            object_id=object_id,
            storage_key=storage_key,
        )
        db.add(reservation)
        await db.commit()
        return StorageReservationHandle(
            reservation_id=reservation.reservation_uuid,
            bytes_reserved=bytes_count,
        )

    async def commit_reservation(
        self,
        db: AsyncSession,
        reservation_id: str,
        *,
        object_type: str | None = None,
        object_id: str | None = None,
        storage_key: str | None = None,
    ) -> None:
        reservation = await self.repository.reservation(db, reservation_id, lock=True)
        if reservation is None:
            raise ResourceNotFoundException("storage_usage_reservation", reservation_id)
        if reservation.status != StorageUsageReservationStatus.RESERVED:
            return
        account = await self._ensure_account(db, reservation.user_id, lock=True)
        counter = await self._ensure_counter(db, reservation.user_id, reservation.category, lock=True)
        commit_reserved_usage(
            account=account,
            counter=counter,
            reservation=reservation,
            object_type=object_type,
            object_id=object_id,
            storage_key=storage_key,
        )
        db.add(
            new_usage_event(
                user_id=reservation.user_id,
                category=reservation.category,
                delta_bytes=reservation.bytes_reserved,
                counts_toward_quota=reservation.counts_toward_quota,
                reason=reservation.reason,
                object_type=reservation.object_type,
                object_id=reservation.object_id,
                storage_key=reservation.storage_key,
            )
        )
        await db.commit()

    async def release_reservation(self, db: AsyncSession, reservation_id: str) -> None:
        reservation = await self.repository.reservation(db, reservation_id, lock=True)
        if reservation is None or reservation.status != StorageUsageReservationStatus.RESERVED:
            return
        account = await self._ensure_account(db, reservation.user_id, lock=True)
        counter = await self._ensure_counter(db, reservation.user_id, reservation.category, lock=True)
        release_reserved_usage(account=account, counter=counter, reservation=reservation)
        await db.commit()

    async def record_allocation(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        category: StorageUsageCategory,
        bytes_count: int,
        reason: str,
        object_type: str | None = None,
        object_id: str | None = None,
        storage_key: str | None = None,
    ) -> None:
        if bytes_count <= 0:
            return
        handle = await self.reserve(
            db,
            user_id=user_id,
            category=category,
            bytes_count=bytes_count,
            reason=reason,
            object_type=object_type,
            object_id=object_id,
            storage_key=storage_key,
        )
        await self.commit_reservation(
            db,
            handle.reservation_id,
            object_type=object_type,
            object_id=object_id,
            storage_key=storage_key,
        )

    async def record_release(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        category: StorageUsageCategory,
        bytes_count: int,
        reason: str,
        object_type: str | None = None,
        object_id: str | None = None,
        storage_key: str | None = None,
    ) -> None:
        if bytes_count <= 0:
            return
        account = await self._ensure_account(db, user_id, lock=True)
        counter = await self._ensure_counter(db, user_id, category, lock=True)
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
        await db.commit()

    def reserve_sync(
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
    ) -> StorageReservationHandle:
        if bytes_count <= 0:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="bytes_count",
                details={"bytes_count": bytes_count},
            )
        account = self._ensure_account_sync(db, user_id, lock=True)
        counter = self._ensure_counter_sync(db, user_id, category, lock=True)
        counts_toward_quota_value = counts_toward_quota(category)
        apply_reservation_hold(
            account=account,
            counter=counter,
            bytes_count=bytes_count,
            counts_toward_quota=counts_toward_quota_value,
        )
        reservation = new_reservation(
            user_id=user_id,
            category=category,
            bytes_count=bytes_count,
            counts_toward_quota=counts_toward_quota_value,
            reason=reason,
            object_type=object_type,
            object_id=object_id,
            storage_key=storage_key,
        )
        db.add(reservation)
        db.commit()
        return StorageReservationHandle(reservation.reservation_uuid, bytes_count)

    def commit_reservation_sync(
        self,
        db: Session,
        reservation_id: str,
        *,
        object_type: str | None = None,
        object_id: str | None = None,
        storage_key: str | None = None,
    ) -> None:
        reservation = self.repository.reservation_sync(db, reservation_id, lock=True)
        if reservation is None:
            raise ResourceNotFoundException("storage_usage_reservation", reservation_id)
        if reservation.status != StorageUsageReservationStatus.RESERVED:
            return
        account = self._ensure_account_sync(db, reservation.user_id, lock=True)
        counter = self._ensure_counter_sync(db, reservation.user_id, reservation.category, lock=True)
        commit_reserved_usage(
            account=account,
            counter=counter,
            reservation=reservation,
            object_type=object_type,
            object_id=object_id,
            storage_key=storage_key,
        )
        db.add(
            new_usage_event(
                user_id=reservation.user_id,
                category=reservation.category,
                delta_bytes=reservation.bytes_reserved,
                counts_toward_quota=reservation.counts_toward_quota,
                reason=reservation.reason,
                object_type=reservation.object_type,
                object_id=reservation.object_id,
                storage_key=reservation.storage_key,
            )
        )
        db.commit()

    def release_reservation_sync(self, db: Session, reservation_id: str) -> None:
        reservation = self.repository.reservation_sync(db, reservation_id, lock=True)
        if reservation is None or reservation.status != StorageUsageReservationStatus.RESERVED:
            return
        account = self._ensure_account_sync(db, reservation.user_id, lock=True)
        counter = self._ensure_counter_sync(db, reservation.user_id, reservation.category, lock=True)
        release_reserved_usage(account=account, counter=counter, reservation=reservation)
        db.commit()

    def record_allocation_sync(
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
        if bytes_count <= 0:
            return
        handle = self.reserve_sync(
            db,
            user_id=user_id,
            category=category,
            bytes_count=bytes_count,
            reason=reason,
            object_type=object_type,
            object_id=object_id,
            storage_key=storage_key,
        )
        self.commit_reservation_sync(
            db,
            handle.reservation_id,
            object_type=object_type,
            object_id=object_id,
            storage_key=storage_key,
        )

    def record_release_sync(
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
        if bytes_count <= 0:
            return
        account = self._ensure_account_sync(db, user_id, lock=True)
        counter = self._ensure_counter_sync(db, user_id, category, lock=True)
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
        db.commit()

    async def _ensure_account(
        self, db: AsyncSession, user_id: int, *, lock: bool
    ) -> StorageUsageAccount:
        account = await self.repository.account(db, user_id, lock=lock)
        if account is not None:
            return account
        policy = await self._require_default_policy(db)
        account = StorageUsageAccount(
            user_id=user_id,
            plan_code=policy.plan_code,
            used_bytes=0,
            reserved_bytes=0,
            quota_limit_bytes=policy.quota_limit_bytes,
            created_at=utc_now_naive(),
            updated_at=utc_now_naive(),
        )
        db.add(account)
        await db.flush()
        return account

    def _ensure_account_sync(self, db: Session, user_id: int, *, lock: bool) -> StorageUsageAccount:
        account = self.repository.account_sync(db, user_id, lock=lock)
        if account is not None:
            return account
        policy = self._require_default_policy_sync(db)
        account = StorageUsageAccount(
            user_id=user_id,
            plan_code=policy.plan_code,
            used_bytes=0,
            reserved_bytes=0,
            quota_limit_bytes=policy.quota_limit_bytes,
            created_at=utc_now_naive(),
            updated_at=utc_now_naive(),
        )
        db.add(account)
        db.flush()
        return account

    async def _ensure_counter(
        self,
        db: AsyncSession,
        user_id: int,
        category: StorageUsageCategory,
        *,
        lock: bool,
    ) -> StorageUsageCounter:
        counter = await self.repository.counter(db, user_id, category, lock=lock)
        if counter is not None:
            return counter
        counter = StorageUsageCounter(
            user_id=user_id,
            category=category,
            used_bytes=0,
            reserved_bytes=0,
            updated_at=utc_now_naive(),
        )
        db.add(counter)
        await db.flush()
        return counter

    def _ensure_counter_sync(
        self,
        db: Session,
        user_id: int,
        category: StorageUsageCategory,
        *,
        lock: bool,
    ) -> StorageUsageCounter:
        counter = self.repository.counter_sync(db, user_id, category, lock=lock)
        if counter is not None:
            return counter
        counter = StorageUsageCounter(
            user_id=user_id,
            category=category,
            used_bytes=0,
            reserved_bytes=0,
            updated_at=utc_now_naive(),
        )
        db.add(counter)
        db.flush()
        return counter

    async def _require_default_policy(self, db: AsyncSession) -> StorageQuotaPolicy:
        policy = await self.repository.policy(db, DEFAULT_PLAN_CODE)
        if policy is not None:
            return policy
        raise ResourceNotFoundException(
            "storage_quota_policy",
            DEFAULT_PLAN_CODE,
            ErrorCode.QUOTA_CHECK_UNAVAILABLE,
        )

    def _require_default_policy_sync(self, db: Session) -> StorageQuotaPolicy:
        policy = self.repository.policy_sync(db, DEFAULT_PLAN_CODE)
        if policy is not None:
            return policy
        raise ResourceNotFoundException(
            "storage_quota_policy",
            DEFAULT_PLAN_CODE,
            ErrorCode.QUOTA_CHECK_UNAVAILABLE,
        )

storage_usage_service = StorageUsageService()
