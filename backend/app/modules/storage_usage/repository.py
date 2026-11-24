from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.storage_usage import (
    StorageUsageAccount,
    StorageUsageCategory,
    StorageUsageCounter,
)


class StorageUsageRepository:
    def account(
        self, db: Session, user_id: int, *, lock: bool = False
    ) -> StorageUsageAccount | None:
        statement = select(StorageUsageAccount).where(StorageUsageAccount.user_id == user_id)
        if lock:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return db.execute(statement).scalar_one_or_none()

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

    def counters(self, db: Session, user_id: int) -> list[StorageUsageCounter]:
        return list(
            (db.execute(select(StorageUsageCounter).where(StorageUsageCounter.user_id == user_id)))
            .scalars()
            .all()
        )
