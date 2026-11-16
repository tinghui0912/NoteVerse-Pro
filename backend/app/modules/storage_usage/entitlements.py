"""Current storage entitlement values and explicit user-creation provisioning."""

from dataclasses import dataclass

from sqlalchemy.orm import Session
from starlette.status import HTTP_503_SERVICE_UNAVAILABLE

from app.core.exceptions import AppException
from app.db.models import StorageUsageAccount, UserStorageEntitlement
from app.modules.storage_usage.repository import StorageUsageRepository
from app.shared.error_codes import CustomerErrorCode


DEFAULT_STORAGE_PLAN_CODE = "FREE"


@dataclass(frozen=True)
class EffectiveStorageEntitlement:
    plan_code: str
    limit_bytes: int


def quota_check_unavailable(authority: str) -> AppException:
    return AppException(
        code=CustomerErrorCode.QUOTA_CHECK_UNAVAILABLE,
        status_code=HTTP_503_SERVICE_UNAVAILABLE,
        details={"authority": authority},
    )


def provision_default_storage_state(db: Session, user_id: int) -> None:
    """Admit one entitlement and empty aggregate in the user's creation transaction."""
    if StorageUsageRepository().plan_policy(db, DEFAULT_STORAGE_PLAN_CODE) is None:
        raise quota_check_unavailable("storage_plan_policy")
    db.add(
        UserStorageEntitlement(
            user_id=user_id,
            plan_code=DEFAULT_STORAGE_PLAN_CODE,
            limit_override_bytes=None,
        )
    )
    db.add(StorageUsageAccount(user_id=user_id, used_bytes=0, reserved_bytes=0))
    db.flush()
