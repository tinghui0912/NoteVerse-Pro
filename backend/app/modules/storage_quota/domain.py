"""Pure quota capacity and terminal hold transition rules."""

from datetime import datetime
from app.core.exceptions import ConflictException, ValidationException
from app.db.models.storage_quota import StorageQuotaHoldStatus, StorageQuotaMode
from app.modules.storage_quota.contracts import EffectiveStorageQuota
from app.shared.error_codes import CustomerErrorCode


def available_capacity(quota: EffectiveStorageQuota, used: int, held: int) -> int | None:
    if used < 0 or held < 0:
        raise ValueError("Capacity facts cannot be negative")
    if quota.mode == StorageQuotaMode.UNLIMITED:
        if quota.limit_bytes is not None:
            raise ValueError("Unlimited quota cannot have a finite limit")
        return None
    if quota.mode != StorageQuotaMode.HARD_LIMIT:
        raise ValueError("Unknown storage quota mode")
    if quota.limit_bytes is None or quota.limit_bytes < 0:
        raise ValueError("Hard quota requires a nonnegative limit")
    return max(quota.limit_bytes - used - held, 0)


def admit_capacity(quota: EffectiveStorageQuota, used: int, held: int, requested: int) -> None:
    if requested <= 0:
        raise ValueError("Capacity holds require positive bytes")
    available = available_capacity(quota, used, held)
    if available is not None and requested > available:
        raise ValidationException(
            CustomerErrorCode.STORAGE_QUOTA_EXCEEDED,
            field="storage",
            details={
                "used_bytes": used,
                "reserved_bytes": held,
                "requested_bytes": requested,
                "limit_bytes": quota.limit_bytes,
            },
        )


def hold_transition(
    status: StorageQuotaHoldStatus,
    target: StorageQuotaHoldStatus,
    *,
    expires_at: datetime,
    now: datetime,
) -> bool:
    if target == StorageQuotaHoldStatus.HELD:
        raise ValueError("Terminal holds cannot reactivate")
    if status == target:
        return False
    if status != StorageQuotaHoldStatus.HELD:
        raise ConflictException(
            CustomerErrorCode.VALIDATION_ERROR, {"reason": "quota_hold_terminal"}
        )
    if target == StorageQuotaHoldStatus.CONSUMED and expires_at <= now:
        raise ConflictException(
            CustomerErrorCode.VALIDATION_ERROR, {"reason": "quota_hold_expired"}
        )
    if target == StorageQuotaHoldStatus.EXPIRED and expires_at > now:
        raise ValueError("Live hold cannot expire")
    return True
