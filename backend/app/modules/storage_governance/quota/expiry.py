"""Bounded quota-only expiration; the worker owns the outer transaction."""

from datetime import datetime
from sqlalchemy.orm import Session
from app.modules.storage_governance.quota.states import StorageQuotaHoldStatus
from app.modules.storage_governance.quota.domain import hold_transition
from app.modules.storage_governance.quota.service import StorageQuotaService
from app.modules.storage_governance.quota.entitlements import quota_check_unavailable
from app.shared.time import utc_now


class StorageQuotaExpiry:
    def __init__(self, quota: StorageQuotaService) -> None:
        self.quota = quota

    def expire_due(self, db: Session, *, limit: int = 100, now: datetime | None = None) -> int:
        if not 1 <= limit <= 1000:
            raise ValueError("Quota expiry batch must be between 1 and 1000")
        instant = now or utc_now()
        repository = self.quota.repository
        expired = 0
        for user_id, hold_id in repository.expired_candidates(db, instant, limit):
            if repository.entitlement(db, user_id, lock=True, skip_locked=True) is None:
                if repository.entitlement(db, user_id) is None:
                    # Account erasure may remove the entire lineage after discovery.
                    # A surviving hold without entitlement remains an invariant error.
                    if repository.hold(db, hold_id) is None:
                        continue
                    raise quota_check_unavailable("user_storage_entitlement")
                continue
            self.quota.usage.committed_bytes(db, user_id, lock=True)
            hold = repository.hold(db, hold_id, lock=True, skip_locked=True)
            if (
                hold is None
                or hold.status != StorageQuotaHoldStatus.HELD
                or hold.expires_at > instant
            ):
                continue
            hold_transition(
                hold.status, StorageQuotaHoldStatus.EXPIRED, expires_at=hold.expires_at, now=instant
            )
            expired += int(
                repository.transition(db, hold_id, StorageQuotaHoldStatus.EXPIRED, instant)
            )
        db.flush()
        return expired
