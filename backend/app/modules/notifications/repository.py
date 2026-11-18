from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, func, select, update, tuple_
from sqlalchemy.orm import Session
from sqlmodel import col

from app.db.models import Notification


notification_created_col = Notification.__table__.c.created_at


class NotificationRepository:
    def list_for_user(
        self,
        db: Session,
        user_id: int,
        *,
        limit: int = 50,
        before: tuple[datetime, int] | None = None,
    ) -> list[Notification]:
        statement = select(Notification).where(Notification.recipient_user_id == user_id)
        if before is not None:
            statement = statement.where(tuple_(Notification.created_at, Notification.id) < before)
        return list(
            db.scalars(
                statement.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(
                    limit
                )
            )
        )

    def unread_count(self, db: Session, user_id: int) -> int:
        result = db.execute(
            select(func.count(Notification.id)).where(
                Notification.recipient_user_id == user_id,
                col(Notification.read_at).is_(None),
            )
        )
        return int(result.scalar_one())

    def mark_all_read_for_user(self, db: Session, user_id: int, *, read_at: datetime) -> int:
        result = db.execute(
            update(Notification)
            .where(
                Notification.recipient_user_id == user_id,
                col(Notification.read_at).is_(None),
            )
            .values(read_at=read_at)
        )
        return int(result.rowcount or 0)

    def by_uuid(self, db: Session, notification_uuid: str) -> Notification | None:
        return (
            db.execute(
                select(Notification).where(Notification.notification_uuid == notification_uuid)
            )
        ).scalar_one_or_none()

    def by_dedupe_key(self, db: Session, dedupe_key: str) -> Notification | None:
        return (
            db.execute(select(Notification).where(Notification.dedupe_key == dedupe_key))
        ).scalar_one_or_none()

    def delete_older_than(self, db: Session, cutoff: datetime) -> int:
        result = db.execute(delete(Notification).where(Notification.created_at < cutoff))
        return int(result.rowcount or 0)
