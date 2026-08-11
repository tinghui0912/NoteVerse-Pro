from __future__ import annotations

import uuid

from app.core.exceptions import ValidationException
from app.db.models import (
    StorageUsageAccount,
    StorageUsageCategory,
    StorageUsageEvent,
    StorageUsageReservation,
    StorageUsageReservationStatus,
)
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


DEFAULT_PLAN_CODE = "FREE"
QUOTA_CATEGORIES = {
    StorageUsageCategory.SOURCE,
    StorageUsageCategory.UPLOAD,
    StorageUsageCategory.INPUT_ASSET,
}


def counts_toward_quota(category: StorageUsageCategory) -> bool:
    return category in QUOTA_CATEGORIES


def assert_quota_available(account: StorageUsageAccount, bytes_count: int) -> None:
    if account.used_bytes + account.reserved_bytes + bytes_count <= account.quota_limit_bytes:
        return
    raise ValidationException(
        ErrorCode.STORAGE_QUOTA_EXCEEDED,
        field="storage",
        details={
            "used_bytes": account.used_bytes,
            "reserved_bytes": account.reserved_bytes,
            "requested_bytes": bytes_count,
            "limit_bytes": account.quota_limit_bytes,
        },
    )


def new_reservation(
    *,
    user_id: int,
    category: StorageUsageCategory,
    bytes_count: int,
    counts_toward_quota: bool,
    reason: str,
    object_type: str | None = None,
    object_id: str | None = None,
    storage_key: str | None = None,
) -> StorageUsageReservation:
    now = utc_now_naive()
    return StorageUsageReservation(
        reservation_uuid=str(uuid.uuid4()),
        user_id=user_id,
        category=category,
        bytes_reserved=bytes_count,
        counts_toward_quota=counts_toward_quota,
        status=StorageUsageReservationStatus.RESERVED,
        reason=reason,
        object_type=object_type,
        object_id=object_id,
        storage_key=storage_key,
        created_at=now,
        updated_at=now,
    )


def new_usage_event(
    *,
    user_id: int,
    category: StorageUsageCategory,
    delta_bytes: int,
    counts_toward_quota: bool,
    reason: str,
    object_type: str | None = None,
    object_id: str | None = None,
    storage_key: str | None = None,
) -> StorageUsageEvent:
    return StorageUsageEvent(
        user_id=user_id,
        category=category,
        delta_bytes=delta_bytes,
        counts_toward_quota=counts_toward_quota,
        reason=reason,
        object_type=object_type,
        object_id=object_id,
        storage_key=storage_key,
        created_at=utc_now_naive(),
    )
