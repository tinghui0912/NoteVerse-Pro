"""Account erasure intent and lifecycle-parent persistence; no commits."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import User, AccountDeletionOperation


class AccountDeletionRepository:
    def lock_user(self, db: Session, user_id: int, *, erasure: bool = False) -> User | None:
        query = select(User).where(User.id == user_id)
        query = query.with_for_update() if erasure else query.with_for_update(key_share=True)
        return db.scalar(query.execution_options(populate_existing=True))

    def for_user(self, db: Session, user_id: int) -> AccountDeletionOperation | None:
        return db.scalar(
            select(AccountDeletionOperation).where(
                AccountDeletionOperation.user_id_snapshot == user_id
            )
        )

    def operation(
        self, db: Session, uuid: str, *, lock: bool = False
    ) -> AccountDeletionOperation | None:
        query = select(AccountDeletionOperation).where(
            AccountDeletionOperation.operation_uuid == uuid
        )
        if lock:
            query = query.with_for_update()
        return db.scalar(query.execution_options(populate_existing=True))
