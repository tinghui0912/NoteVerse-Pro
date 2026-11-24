"""Immutable capacity admission values and application contract."""

from dataclasses import dataclass
from datetime import datetime
from typing import Mapping, Protocol
from sqlalchemy.orm import Session
from app.db.models.storage_quota import StoragePlanCode, StorageQuotaHoldStatus
from app.db.models.storage_usage import StorageUsageCategory


@dataclass(frozen=True)
class EffectiveStorageQuota:
    plan_code: StoragePlanCode
    limit_bytes: int


@dataclass(frozen=True)
class StorageQuotaSnapshot:
    entitlement: EffectiveStorageQuota
    used_bytes: int
    reserved_bytes: int
    available_bytes: int
    categories: Mapping[StorageUsageCategory, int]


@dataclass(frozen=True)
class StorageQuotaHoldReceipt:
    hold_id: int
    hold_uuid: str
    user_id: int
    category: StorageUsageCategory
    bytes_held: int
    status: StorageQuotaHoldStatus
    expires_at: datetime


class StorageQuotaReader(Protocol):
    def snapshot_user(
        self, db: Session, user_id: int, *, lock: bool = False
    ) -> StorageQuotaSnapshot: ...


class StorageQuotaCommands(Protocol):
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
    ) -> StorageQuotaHoldReceipt: ...
    def lock_hold(self, db: Session, hold_id: int) -> StorageQuotaHoldReceipt: ...
    def consume_hold(self, db: Session, hold_id: int) -> bool: ...
    def release_hold(self, db: Session, hold_id: int, *, now: datetime | None = None) -> bool: ...
