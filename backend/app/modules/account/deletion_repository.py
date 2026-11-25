"""Account erasure intent and lifecycle-parent persistence; no commits."""

from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from app.shared.integrity import ResourceIntegrityError
from app.db.models import User, AccountDeletionOperation
from app.db.models.auth import EmailChangeRequest


class AccountDeletionRepository:
    def erase_closed_identity(self, db: Session, user: User) -> None:
        if user.deleted_at is None or user.is_active:
            raise ResourceIntegrityError("Erasure requires a closed identity")
        db.execute(delete(User).where(User.id == user.id))

    def erase_security_history(self, db: Session, user_id: int, *, limit: int) -> bool:
        ids = list(
            db.scalars(
                select(EmailChangeRequest.id)
                .where(EmailChangeRequest.user_id == user_id)
                .order_by(EmailChangeRequest.id)
                .limit(limit)
            )
        )
        if not ids:
            return False
        db.execute(delete(EmailChangeRequest).where(EmailChangeRequest.id.in_(ids)))
        return True

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
