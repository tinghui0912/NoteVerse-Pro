from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session
from sqlmodel import col

from app.db.models import NotificationEvent


notification_created_col = NotificationEvent.__table__.c.created_at


class NotificationRepository:
    def list_for_user(
        self, db: Session, user_id: int, *, limit: int = 50
    ) -> list[NotificationEvent]:
        return list(
            (
                db.execute(
                    select(NotificationEvent)
                    .where(NotificationEvent.recipient_user_id == user_id)
                    .order_by(notification_created_col.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )

    def unread_count(self, db: Session, user_id: int) -> int:
        result = db.execute(
            select(func.count(NotificationEvent.id)).where(
                NotificationEvent.recipient_user_id == user_id,
                col(NotificationEvent.read_at).is_(None),
            )
        )
        return int(result.scalar_one())

    def mark_all_read_for_user(self, db: Session, user_id: int, *, read_at: datetime) -> int:
        result = db.execute(
            update(NotificationEvent)
            .where(
                NotificationEvent.recipient_user_id == user_id,
                col(NotificationEvent.read_at).is_(None),
            )
            .values(read_at=read_at)
        )
        return int(result.rowcount or 0)

    def by_uuid(self, db: Session, notification_uuid: str) -> NotificationEvent | None:
        return (
            db.execute(
                select(NotificationEvent).where(
                    NotificationEvent.notification_uuid == notification_uuid
                )
            )
        ).scalar_one_or_none()

    def by_dedupe_key(self, db: Session, dedupe_key: str) -> NotificationEvent | None:
        return (
            db.execute(select(NotificationEvent).where(NotificationEvent.dedupe_key == dedupe_key))
        ).scalar_one_or_none()

    def delete_older_than(self, db: Session, cutoff: datetime) -> int:
        result = db.execute(delete(NotificationEvent).where(NotificationEvent.created_at < cutoff))
        return int(result.rowcount or 0)
