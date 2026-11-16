from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    StoragePlanPolicy,
    UserStorageEntitlement,
    StorageUsageAccount,
    StorageUsageCategory,
    StorageUsageCounter,
    StorageUsageReservation,
)


class StorageUsageRepository:
    def entitlement(
        self, db: Session, user_id: int, *, lock: bool = False
    ) -> UserStorageEntitlement | None:
        statement = (
            select(UserStorageEntitlement)
            .where(UserStorageEntitlement.user_id == user_id)
            .execution_options(populate_existing=True)
        )
        if lock:
            statement = statement.with_for_update()
        return db.execute(statement).scalar_one_or_none()

    def account(
        self, db: Session, user_id: int, *, lock: bool = False
    ) -> StorageUsageAccount | None:
        statement = select(StorageUsageAccount).where(StorageUsageAccount.user_id == user_id)
        if lock:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return db.execute(statement).scalar_one_or_none()

    def plan_policy(self, db: Session, plan_code: str) -> StoragePlanPolicy | None:
        return db.execute(
            select(StoragePlanPolicy)
            .where(StoragePlanPolicy.plan_code == plan_code)
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()

    def counter(
        self,
        db: Session,
        user_id: int,
        category: StorageUsageCategory,
        *,
        lock: bool = False,
    ) -> StorageUsageCounter | None:
        statement = select(StorageUsageCounter).where(
            StorageUsageCounter.user_id == user_id,
            StorageUsageCounter.category == category,
        )
        if lock:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return db.execute(statement).scalar_one_or_none()

    def reservation(
        self, db: Session, reservation_uuid: str, *, lock: bool = False
    ) -> StorageUsageReservation | None:
        statement = select(StorageUsageReservation).where(
            StorageUsageReservation.reservation_uuid == reservation_uuid
        )
        if lock:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return db.execute(statement).scalar_one_or_none()

    def counters(self, db: Session, user_id: int) -> list[StorageUsageCounter]:
        return list(
            (db.execute(select(StorageUsageCounter).where(StorageUsageCounter.user_id == user_id)))
            .scalars()
            .all()
        )
