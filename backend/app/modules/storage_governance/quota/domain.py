"""Pure quota capacity and terminal hold transition rules."""

from datetime import datetime
from app.core.exceptions import ConflictException, ValidationException
from app.modules.storage_governance.quota.states import StorageQuotaHoldStatus
from app.modules.storage_governance.quota.contracts import EffectiveStorageQuota
from app.shared.error_codes import CustomerErrorCode


def available_capacity(quota: EffectiveStorageQuota, used: int, held: int) -> int:
    if used < 0 or held < 0:
        raise ValueError("Capacity facts cannot be negative")
    if type(quota.limit_bytes) is not int or quota.limit_bytes < 0:
        raise ValueError("Quota requires a nonnegative integer limit")
    return max(quota.limit_bytes - used - held, 0)


def admit_capacity(quota: EffectiveStorageQuota, used: int, held: int, requested: int) -> None:
    if type(requested) is not int or requested <= 0:
        raise ValueError("Capacity holds require positive bytes")
    available = available_capacity(quota, used, held)
    if requested > available:
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
