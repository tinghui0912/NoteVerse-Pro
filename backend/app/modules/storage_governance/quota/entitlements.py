"""Storage quota policy interpretation and user entitlement provisioning."""

from sqlalchemy.orm import Session
from app.core.exceptions import AppException
from app.db.models.storage_quota import UserStorageEntitlement
from app.modules.storage_governance.quota.states import StoragePlanCode
from app.modules.storage_governance.quota.contracts import EffectiveStorageQuota
from app.modules.storage_governance.quota.repository import StorageQuotaRepository
from app.shared.error_codes import CustomerErrorCode

DEFAULT_STORAGE_PLAN_CODE = StoragePlanCode.FREE


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
        return EffectiveStorageQuota(entitlement.plan_code, policy.default_limit_bytes)

    def change_plan(
        self, db: Session, user_id: int, plan_code: StoragePlanCode
    ) -> EffectiveStorageQuota:
        """Trusted application boundary; never a customer self-upgrade capability.

        Entitlement serialization makes subsequent admission observe this decision.
        Existing allocations and live holds are unchanged, including on downgrade.
        """
        if not isinstance(plan_code, StoragePlanCode):
            raise ValueError("A supported storage plan is required")
        entitlement = self.repository.entitlement(db, user_id, lock=True)
        if entitlement is None:
            raise quota_check_unavailable("user_storage_entitlement")
        if self.repository.policy(db, plan_code) is None:
            raise quota_check_unavailable("storage_plan_policy")
        entitlement.plan_code = plan_code
        db.flush()
        return self.resolve(db, user_id)

    def provision(self, db: Session, user_id: int) -> None:
        if self.repository.policy(db, DEFAULT_STORAGE_PLAN_CODE) is None:
            raise quota_check_unavailable("storage_plan_policy")
        db.add(UserStorageEntitlement(user_id=user_id, plan_code=DEFAULT_STORAGE_PLAN_CODE))
        db.flush()
