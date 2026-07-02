from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import NotificationEvent


notification_created_col = NotificationEvent.__table__.c.created_at


class NotificationRepository:
    async def list_for_user(
        self, db: AsyncSession, user_id: int, *, limit: int = 50
    ) -> list[NotificationEvent]:
        return list(
            (
                await db.execute(
                    select(NotificationEvent)
                    .where(NotificationEvent.recipient_user_id == user_id)
                    .order_by(notification_created_col.desc())
                    .limit(limit)
                )
            ).scalars().all()
        )

    async def unread_count(self, db: AsyncSession, user_id: int) -> int:
        result = await db.execute(
            select(func.count(NotificationEvent.id)).where(
                NotificationEvent.recipient_user_id == user_id,
                NotificationEvent.read_at.is_(None),
            )
        )
        return int(result.scalar_one())

    async def by_uuid(
        self, db: AsyncSession, notification_uuid: str
    ) -> NotificationEvent | None:
        return (
            await db.execute(
                select(NotificationEvent).where(
                    NotificationEvent.notification_uuid == notification_uuid
                )
            )
        ).scalar_one_or_none()

    async def by_dedupe_key(
        self, db: AsyncSession, dedupe_key: str
    ) -> NotificationEvent | None:
        return (
            await db.execute(
                select(NotificationEvent).where(
                    NotificationEvent.dedupe_key == dedupe_key
                )
            )
        ).scalar_one_or_none()

    async def delete_older_than(self, db: AsyncSession, cutoff: datetime) -> int:
        result = await db.execute(
            delete(NotificationEvent).where(NotificationEvent.created_at < cutoff)
        )
        return int(result.rowcount or 0)
