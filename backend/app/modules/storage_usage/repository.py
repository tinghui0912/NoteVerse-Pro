from __future__ import annotations

from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from app.db.models.storage_usage import (
    StorageUsageAccount,
    StorageUsageCategory,
    StorageUsageCounter,
    StorageUsageEvent,
)


class StorageUsageRepository:
    def has_nonzero_counters(self, db: Session, user_id: int) -> bool:
        return (
            db.scalar(
                select(StorageUsageCounter.user_id)
                .where(StorageUsageCounter.user_id == user_id, StorageUsageCounter.used_bytes != 0)
                .limit(1)
            )
            is not None
        )

    def erase_user_events(self, db: Session, user_id: int, *, limit: int) -> bool:
        ids = list(
            db.scalars(
                select(StorageUsageEvent.id)
                .where(StorageUsageEvent.user_id == user_id)
                .order_by(StorageUsageEvent.id)
                .limit(limit)
            )
        )
        if not ids:
            return False
        db.execute(delete(StorageUsageEvent).where(StorageUsageEvent.id.in_(ids)))
        return True

    def account(
        self, db: Session, user_id: int, *, lock: bool = False, skip_locked: bool = False
    ) -> StorageUsageAccount | None:
        statement = select(StorageUsageAccount).where(StorageUsageAccount.user_id == user_id)
        if lock:
            statement = statement.with_for_update(skip_locked=skip_locked).execution_options(
                populate_existing=True
            )
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
