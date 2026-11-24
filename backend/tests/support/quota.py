"""Test command admission and committed allocation using the real domain APIs."""

from datetime import datetime, timedelta
from uuid import uuid4
from sqlalchemy.orm import Session
from app.db.models.storage_quota import StorageQuotaHold, StorageQuotaHoldStatus
from app.composition.storage_resources import storage_quota_service
from app.modules.storage_quota.contracts import StorageQuotaHoldReceipt
from app.modules.storage_usage.service import storage_usage_service
from app.db.models.storage_usage import StorageUsageCategory
from app.shared.time import utc_now


def admit_hold(
    db: Session, *, user_id: int, category: StorageUsageCategory, bytes_count: int
) -> StorageQuotaHoldReceipt:
    return storage_quota_service.create_hold(
        db,
        user_id=user_id,
        category=category,
        bytes_count=bytes_count,
        command_key=str(uuid4()),
        expires_at=utc_now() + timedelta(hours=1),
    )


def allocate_hold(
    db: Session,
    hold_id: int,
    *,
    object_type: str | None = None,
    object_id: str | None = None,
    storage_key: str | None = None,
) -> None:
    hold = storage_quota_service.lock_hold(db, hold_id)
    if storage_quota_service.consume_hold(db, hold_id):
        storage_usage_service.record_allocation(
            db,
            user_id=hold.user_id,
            category=hold.category,
            bytes_count=hold.bytes_held,
            reason="test_allocation",
            object_type=object_type,
            object_id=object_id,
            storage_key=storage_key,
        )


def quota_hold_fact(
    db: Session,
    user_id: int,
    *,
    bytes_count: int = 1,
    status: StorageQuotaHoldStatus = StorageQuotaHoldStatus.HELD,
    expires_at: datetime | None = None,
) -> int:
    """Persist fixture lineage without inventing a second usage projection."""
    expiry = expires_at or utc_now() + timedelta(hours=1)
    created = min(utc_now(), expiry - timedelta(hours=1))
    row = StorageQuotaHold(
        user_id=user_id,
        command_key=str(uuid4()),
        category=StorageUsageCategory.UPLOAD,
        bytes_held=bytes_count,
        status=status,
        expires_at=expiry,
        created_at=created,
        updated_at=created,
        consumed_at=created if status == StorageQuotaHoldStatus.CONSUMED else None,
        released_at=created if status == StorageQuotaHoldStatus.RELEASED else None,
        expired_at=expiry if status == StorageQuotaHoldStatus.EXPIRED else None,
    )
    db.add(row)
    db.flush()
    assert row.id is not None
    return row.id
