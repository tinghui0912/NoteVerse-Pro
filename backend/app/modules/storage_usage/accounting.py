from __future__ import annotations
from app.db.models.storage_usage import (
    StorageUsageAccount,
    StorageUsageCounter,
    StorageUsageEvent,
    StorageUsageCategory,
)
from app.shared.time import utc_now


from app.shared.integrity import ResourceIntegrityError


class StorageUsageInvariantError(ResourceIntegrityError):
    """Accounting transition unsupported by the committed projection."""


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
        counts_toward_quota_snapshot=counts_toward_quota,
        reason=reason,
        object_type=object_type,
        object_id=object_id,
        storage_key=storage_key,
        created_at=utc_now(),
    )


def release_used_usage(
    *,
    account: StorageUsageAccount,
    counter: StorageUsageCounter,
    bytes_count: int,
    counts_toward_quota: bool,
) -> int:
    if counter.used_bytes < bytes_count or (
        counts_toward_quota and account.used_bytes < bytes_count
    ):
        raise StorageUsageInvariantError("Storage usage release exceeds accounted allocation")
    if counts_toward_quota:
        account.used_bytes -= bytes_count
        account.updated_at = utc_now()
    counter.used_bytes -= bytes_count
    counter.updated_at = utc_now()
    return bytes_count
