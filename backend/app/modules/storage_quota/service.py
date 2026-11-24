"""Caller-transaction capacity admission, serialized per user before hold locks."""

from datetime import datetime
from types import MappingProxyType
from sqlalchemy.orm import Session
from app.core.exceptions import ConflictException, ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models.storage_quota import StorageQuotaHold, StorageQuotaHoldStatus
from app.db.models.storage_usage import StorageUsageCategory
from app.modules.storage_usage.contracts import StorageUsageReader, counts_toward_quota
from app.modules.storage_quota.contracts import (
    EffectiveStorageQuota,
    StorageQuotaHoldReceipt,
    StorageQuotaSnapshot,
)
from app.modules.storage_quota.domain import admit_capacity, available_capacity, hold_transition
from app.modules.storage_quota.entitlements import StorageQuotaEntitlements
from app.modules.storage_quota.repository import StorageQuotaRepository
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now


class StorageQuotaService:
    def __init__(
        self, usage: StorageUsageReader, repository: StorageQuotaRepository | None = None
    ) -> None:
        self.usage = usage
        self.repository = repository or StorageQuotaRepository()
        self.entitlements = StorageQuotaEntitlements(self.repository)

    def resolve_effective_quota(self, db: Session, user_id: int) -> EffectiveStorageQuota:
        return self.entitlements.resolve(db, user_id)

    def lock_user(self, db: Session, user_id: int) -> tuple[EffectiveStorageQuota, int]:
        quota = self.entitlements.resolve(db, user_id, lock=True)
        used = self.usage.committed_bytes(db, user_id, lock=True)
        return quota, used

    def create_hold(
        self,
        db: Session,
        *,
        user_id: int,
        category: StorageUsageCategory,
        bytes_count: int,
        command_key: str,
        expires_at: datetime,
        now: datetime | None = None,
    ) -> StorageQuotaHoldReceipt:
        if type(bytes_count) is not int or bytes_count <= 0:
            raise ValueError("Capacity holds require positive integer bytes")
        if not command_key or len(command_key) > 160 or not counts_toward_quota(category):
            raise ValueError(
                "Capacity admission requires a command identity and quota-counted category"
            )
        quota, used = self.lock_user(db, user_id)
        instant = now or utc_now()
        existing = self.repository.command_hold(db, user_id, command_key)
        if existing is not None:
            if (
                existing.category != category
                or existing.bytes_held != bytes_count
                or existing.expires_at != expires_at
            ):
                raise ConflictException(
                    CustomerErrorCode.VALIDATION_ERROR, {"reason": "quota_command_conflict"}
                )
            return self._receipt(existing)
        if expires_at <= instant:
            raise ValueError("Hold expiry must be in the future")
        held = sum(self.repository.held_by_category(db, user_id, instant).values())
        admit_capacity(quota, used, held, bytes_count)
        hold = StorageQuotaHold(
            user_id=user_id,
            command_key=command_key,
            category=category,
            bytes_held=bytes_count,
            expires_at=expires_at,
            created_at=instant,
            updated_at=instant,
        )
        db.add(hold)
        db.flush()
        return self._receipt(hold)

    def _lock_hold_row(self, db: Session, hold_id: int) -> StorageQuotaHold | None:
        discovered = self.repository.hold(db, hold_id)
        if discovered is None:
            return None
        self.lock_user(db, discovered.user_id)
        return self.repository.hold(db, hold_id, lock=True)

    def lock_hold(self, db: Session, hold_id: int) -> StorageQuotaHoldReceipt:
        hold = self._lock_hold_row(db, hold_id)
        if hold is None:
            raise ResourceNotFoundException("storage_quota_hold", str(hold_id))
        return self._receipt(hold)

    def consume_hold(self, db: Session, hold_id: int) -> bool:
        hold = self.lock_hold(db, hold_id)
        # Read the clock after lifecycle locks; waiting cannot extend capacity authority.
        return self._apply_transition(db, hold, StorageQuotaHoldStatus.CONSUMED, utc_now())

    def release_hold(self, db: Session, hold_id: int, *, now: datetime | None = None) -> bool:
        hold = self._lock_hold_row(db, hold_id)
        # Cleanup also retries an admission whose transaction never committed.
        if hold is None or hold.status != StorageQuotaHoldStatus.HELD:
            return False
        return self._apply_transition(
            db, self._receipt(hold), StorageQuotaHoldStatus.RELEASED, now or utc_now()
        )

    def _apply_transition(
        self,
        db: Session,
        hold: StorageQuotaHoldReceipt,
        target: StorageQuotaHoldStatus,
        now: datetime,
    ) -> bool:
        if not hold_transition(hold.status, target, expires_at=hold.expires_at, now=now):
            return False
        if not self.repository.transition(db, hold.hold_id, target, now):
            raise ConflictException(
                CustomerErrorCode.VALIDATION_ERROR, {"reason": "quota_hold_transition_lost"}
            )
        db.flush()
        return True

    def snapshot_user(
        self, db: Session, user_id: int, *, lock: bool = False
    ) -> StorageQuotaSnapshot:
        if lock:
            quota, used = self.lock_user(db, user_id)
        else:
            quota = self.entitlements.resolve(db, user_id)
            used = self.usage.committed_bytes(db, user_id)
        held = self.repository.held_by_category(db, user_id, utc_now())
        total = sum(held.values())
        return StorageQuotaSnapshot(
            quota,
            used,
            total,
            available_capacity(quota, used, total),
            MappingProxyType(
                {category: held.get(category, 0) for category in StorageUsageCategory}
            ),
        )

    @staticmethod
    def _receipt(hold: StorageQuotaHold) -> StorageQuotaHoldReceipt:
        return StorageQuotaHoldReceipt(
            require_persisted_id(hold.id, entity="quota hold"),
            hold.hold_uuid,
            hold.user_id,
            hold.category,
            hold.bytes_held,
            hold.status,
            hold.expires_at,
        )
