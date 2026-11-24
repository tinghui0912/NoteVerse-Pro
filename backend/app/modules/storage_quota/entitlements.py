"""Storage quota policy interpretation and user entitlement provisioning."""

from sqlalchemy.orm import Session
from app.core.exceptions import AppException
from app.db.models.storage_quota import UserStorageEntitlement
from app.modules.storage_quota.contracts import EffectiveStorageQuota
from app.modules.storage_quota.repository import StorageQuotaRepository
from app.shared.error_codes import CustomerErrorCode

DEFAULT_STORAGE_PLAN_CODE = "FREE"


def quota_check_unavailable(authority: str) -> AppException:
    return AppException(
        code=CustomerErrorCode.QUOTA_CHECK_UNAVAILABLE,
        status_code=503,
        details={"authority": authority},
    )


class StorageQuotaEntitlements:
    def __init__(self, repository: StorageQuotaRepository) -> None:
        self.repository = repository

    def resolve(self, db: Session, user_id: int, *, lock: bool = False) -> EffectiveStorageQuota:
        entitlement = self.repository.entitlement(db, user_id, lock=lock)
        if entitlement is None:
            raise quota_check_unavailable("user_storage_entitlement")
        policy = self.repository.policy(db, entitlement.plan_code)
        if policy is None:
            raise quota_check_unavailable("storage_plan_policy")
        if entitlement.mode_override is not None:
            return EffectiveStorageQuota(
                entitlement.plan_code, entitlement.mode_override, entitlement.limit_override_bytes
            )
        return EffectiveStorageQuota(entitlement.plan_code, policy.mode, policy.default_limit_bytes)

    def provision(self, db: Session, user_id: int) -> None:
        if self.repository.policy(db, DEFAULT_STORAGE_PLAN_CODE) is None:
            raise quota_check_unavailable("storage_plan_policy")
        db.add(UserStorageEntitlement(user_id=user_id, plan_code=DEFAULT_STORAGE_PLAN_CODE))
        db.flush()
