"""SQL persistence for entitlement and durable capacity hold facts; no commits."""

from datetime import datetime
from sqlalchemy import select, func, update, delete
from sqlalchemy.orm import Session
from app.db.models.storage_quota import StoragePlanPolicy, UserStorageEntitlement, StorageQuotaHold
from app.modules.storage_governance.quota.states import StorageQuotaHoldStatus
from app.modules.storage_governance.usage.domain import StorageUsageCategory


class StorageQuotaRepository:
    def first_held_for_user(self, db: Session, user_id: int) -> StorageQuotaHold | None:
        return db.scalar(
            select(StorageQuotaHold)
            .where(
                StorageQuotaHold.user_id == user_id,
                StorageQuotaHold.status == StorageQuotaHoldStatus.HELD,
            )
            .order_by(StorageQuotaHold.id)
            .limit(1)
        )

    def erase_terminal_user_holds(self, db: Session, user_id: int, *, limit: int) -> bool:
        ids = list(
            db.scalars(
                select(StorageQuotaHold.id)
                .where(
                    StorageQuotaHold.user_id == user_id,
                    StorageQuotaHold.status != StorageQuotaHoldStatus.HELD,
                )
                .order_by(StorageQuotaHold.id)
                .limit(limit)
            )
        )
        if not ids:
            return False
        db.execute(delete(StorageQuotaHold).where(StorageQuotaHold.id.in_(ids)))
        return True

    def entitlement(
        self, db: Session, user_id: int, *, lock: bool = False, skip_locked: bool = False
    ) -> UserStorageEntitlement | None:
        query = (
            select(UserStorageEntitlement)
            .where(UserStorageEntitlement.user_id == user_id)
            .execution_options(populate_existing=True)
        )
        if lock:
            query = query.with_for_update(skip_locked=skip_locked)
        return db.scalar(query)

    def policy(self, db: Session, code: str) -> StoragePlanPolicy | None:
        return db.scalar(
            select(StoragePlanPolicy)
            .where(StoragePlanPolicy.plan_code == code)
            .execution_options(populate_existing=True)
        )

    def hold(
        self, db: Session, hold_id: int, *, lock: bool = False, skip_locked: bool = False
    ) -> StorageQuotaHold | None:
        query = (
            select(StorageQuotaHold)
            .where(StorageQuotaHold.id == hold_id)
            .execution_options(populate_existing=True)
        )
        if lock:
            query = query.with_for_update(skip_locked=skip_locked)
        return db.scalar(query)

    def command_hold(self, db: Session, user_id: int, key: str) -> StorageQuotaHold | None:
        return db.scalar(
            select(StorageQuotaHold)
            .where(StorageQuotaHold.user_id == user_id, StorageQuotaHold.command_key == key)
            .execution_options(populate_existing=True)
        )

    def held_by_category(
        self, db: Session, user_id: int, now: datetime
    ) -> dict[StorageUsageCategory, int]:
        return {
            category: int(total)
            for category, total in db.execute(
                select(StorageQuotaHold.category, func.sum(StorageQuotaHold.bytes_held))
                .where(
                    StorageQuotaHold.user_id == user_id,
                    StorageQuotaHold.status == StorageQuotaHoldStatus.HELD,
                    StorageQuotaHold.expires_at > now,
                )
                .group_by(StorageQuotaHold.category)
            )
        }

    def transition(
        self, db: Session, hold_id: int, target: StorageQuotaHoldStatus, now: datetime
    ) -> bool:
        timestamp = {
            StorageQuotaHoldStatus.CONSUMED: "consumed_at",
            StorageQuotaHoldStatus.RELEASED: "released_at",
            StorageQuotaHoldStatus.EXPIRED: "expired_at",
        }[target]
        query = update(StorageQuotaHold).where(
            StorageQuotaHold.id == hold_id, StorageQuotaHold.status == StorageQuotaHoldStatus.HELD
        )
        if target == StorageQuotaHoldStatus.CONSUMED:
            query = query.where(StorageQuotaHold.expires_at > now)
        elif target == StorageQuotaHoldStatus.EXPIRED:
            query = query.where(StorageQuotaHold.expires_at <= now)
        return (
            db.execute(
                query.values(status=target, updated_at=now, **{timestamp: now}).returning(
                    StorageQuotaHold.id
                )
            ).scalar_one_or_none()
            is not None
        )

    def expired_candidates(self, db: Session, now: datetime, limit: int) -> list[tuple[int, int]]:
        return [
            (user_id, hold_id)
            for user_id, hold_id in db.execute(
                select(StorageQuotaHold.user_id, StorageQuotaHold.id)
                .where(
                    StorageQuotaHold.status == StorageQuotaHoldStatus.HELD,
                    StorageQuotaHold.expires_at <= now,
                )
                .order_by(StorageQuotaHold.user_id, StorageQuotaHold.id)
                .limit(limit)
            )
        ]
