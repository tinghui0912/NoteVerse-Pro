from __future__ import annotations

import uuid

from app.core.exceptions import ValidationException
from app.db.models import (
    StorageUsageAccount,
    StorageUsageCategory,
    StorageUsageCounter,
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


def apply_reservation_hold(
    *,
    account: StorageUsageAccount,
    counter: StorageUsageCounter,
    bytes_count: int,
    counts_toward_quota: bool,
) -> None:
    if counts_toward_quota:
        assert_quota_available(account, bytes_count)
        account.reserved_bytes += bytes_count
        account.updated_at = utc_now_naive()
    counter.reserved_bytes += bytes_count
    counter.updated_at = utc_now_naive()


def commit_reserved_usage(
    *,
    account: StorageUsageAccount,
    counter: StorageUsageCounter,
    reservation: StorageUsageReservation,
    object_type: str | None = None,
    object_id: str | None = None,
    storage_key: str | None = None,
) -> None:
    if reservation.counts_toward_quota:
        account.reserved_bytes -= reservation.bytes_reserved
        account.used_bytes += reservation.bytes_reserved
        account.updated_at = utc_now_naive()
    counter.reserved_bytes -= reservation.bytes_reserved
    counter.used_bytes += reservation.bytes_reserved
    counter.updated_at = utc_now_naive()
    reservation.status = StorageUsageReservationStatus.COMMITTED
    reservation.object_type = object_type or reservation.object_type
    reservation.object_id = object_id or reservation.object_id
    reservation.storage_key = storage_key or reservation.storage_key
    reservation.updated_at = utc_now_naive()


def release_reserved_usage(
    *,
    account: StorageUsageAccount,
    counter: StorageUsageCounter,
    reservation: StorageUsageReservation,
) -> None:
    if reservation.counts_toward_quota:
        account.reserved_bytes -= reservation.bytes_reserved
        account.updated_at = utc_now_naive()
    counter.reserved_bytes -= reservation.bytes_reserved
    counter.updated_at = utc_now_naive()
    reservation.status = StorageUsageReservationStatus.RELEASED
    reservation.updated_at = utc_now_naive()


def release_used_usage(
    *,
    account: StorageUsageAccount,
    counter: StorageUsageCounter,
    bytes_count: int,
    counts_toward_quota: bool,
) -> int:
    released = min(bytes_count, counter.used_bytes)
    if counts_toward_quota:
        account.used_bytes = max(account.used_bytes - released, 0)
        account.updated_at = utc_now_naive()
    counter.used_bytes = max(counter.used_bytes - released, 0)
    counter.updated_at = utc_now_naive()
    return released
