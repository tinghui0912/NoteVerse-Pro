from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import NotificationEvent, Score, ScoreMembership, ScoreRevision, User
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.schemas import (
    NotificationActorRead,
    NotificationEventRead,
    NotificationUnreadCountRead,
)
from app.shared.constants import ErrorCode
from app.modules.realtime.publisher import RealtimeEventTypes, publish_event_best_effort
from app.utils.timezone import utc_now_naive

logger = logging.getLogger(__name__)


class NotificationTypes:
    SCORE_INVITE_ACCEPTED = "score_invite.accepted"
    SCORE_INVITE_DECLINED = "score_invite.declined"
    SCORE_INVITE_REVOKED = "score_invite.revoked"
    SCORE_VERSION_CREATED = "score.version.created"
    IMPORT_COMPLETED = "import.completed"
    IMPORT_FAILED = "import.failed"
    SYSTEM = "system"


class NotificationService:
    def __init__(self, repository: NotificationRepository | None = None) -> None:
        self.repository = repository or NotificationRepository()

    async def create_event(
        self,
        db: AsyncSession,
        *,
        recipient_user_id: int,
        actor_user_id: int | None,
        type: str,
        resource_type: str,
        title: str,
        body: str | None = None,
        resource_id: str | None = None,
        score_id: str | None = None,
        data: dict[str, Any] | None = None,
        dedupe_key: str | None = None,
    ) -> NotificationEventRead | None:
        if actor_user_id == recipient_user_id:
            return None
        if dedupe_key:
            existing = await self.repository.by_dedupe_key(db, dedupe_key)
            if existing:
                return await self._event_read(db, existing)
        event = NotificationEvent(
            recipient_user_id=recipient_user_id,
            actor_user_id=actor_user_id,
            type=type,
            dedupe_key=dedupe_key,
            resource_type=resource_type,
            resource_id=resource_id,
            score_id=score_id,
            title=title,
            body=body,
            data=data or {},
            created_at=utc_now_naive(),
        )
        db.add(event)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            if dedupe_key:
                existing = await self.repository.by_dedupe_key(db, dedupe_key)
                if existing:
                    return await self._event_read(db, existing)
            raise
        await db.refresh(event)
        event_read = await self._event_read(db, event)
        await publish_event_best_effort(
            db,
            recipient_user_id=recipient_user_id,
            type=RealtimeEventTypes.NOTIFICATION_CREATED,
            resource_type="notification",
            resource_id=event.notification_uuid,
            score_id=score_id,
            payload=event_read.model_dump(mode="json"),
        )
        return event_read

    async def create_event_best_effort(
        self,
        db: AsyncSession,
        **kwargs,
    ) -> NotificationEventRead | None:
        try:
            return await self.create_event(db, **kwargs)
        except Exception:
            await db.rollback()
            logger.exception("Failed to create notification event", extra={"type": kwargs.get("type")})
            return None

    async def notify_score_version_created_best_effort(
        self,
        db: AsyncSession,
        *,
        score: Score,
        revision: ScoreRevision,
        actor: User,
    ) -> None:
        actor_id = actor.id
        if actor_id is None:
            return
        recipients = await self._score_notification_recipients(db, score)
        actor_name = actor.display_name or actor.email
        for recipient_user_id in recipients:
            await self.create_event_best_effort(
                db,
                recipient_user_id=recipient_user_id,
                actor_user_id=actor_id,
                type=NotificationTypes.SCORE_VERSION_CREATED,
                resource_type="score",
                resource_id=score.score_uuid,
                score_id=score.score_uuid,
                title="Score version saved",
                body=f"{actor_name} saved a new version of {score.title}.",
                dedupe_key=(
                    f"{NotificationTypes.SCORE_VERSION_CREATED}:"
                    f"{revision.revision_uuid}:{recipient_user_id}"
                ),
                data={
                    "score_title": score.title,
                    "revision_id": revision.revision_uuid,
                    "revision_number": revision.revision_number,
                    "origin": revision.origin.value,
                },
            )

    async def list_for_user(
        self, db: AsyncSession, user_id: int, *, limit: int = 50
    ) -> list[NotificationEventRead]:
        user = await db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        events = await self.repository.list_for_user(db, user_id, limit=limit)
        return [await self._event_read(db, event) for event in events]

    async def unread_count(
        self, db: AsyncSession, user_id: int
    ) -> NotificationUnreadCountRead:
        user = await db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        return NotificationUnreadCountRead(
            count=await self.repository.unread_count(db, user_id)
        )

    async def mark_read(
        self, db: AsyncSession, notification_uuid: str, user_id: int
    ) -> NotificationEventRead:
        event = await self.repository.by_uuid(db, notification_uuid)
        if not event:
            raise ResourceNotFoundException(
                "notification", notification_uuid, ErrorCode.NOTIFICATION_NOT_FOUND
            )
        if event.recipient_user_id != user_id:
            raise ResourceNotFoundException(
                "notification", notification_uuid, ErrorCode.NOTIFICATION_NOT_FOUND
            )
        if event.read_at is None:
            event.read_at = utc_now_naive()
            await db.commit()
            await db.refresh(event)
        return await self._event_read(db, event)

    async def mark_all_read(self, db: AsyncSession, user_id: int) -> NotificationUnreadCountRead:
        events = await self.repository.list_for_user(db, user_id, limit=200)
        now = utc_now_naive()
        for event in events:
            if event.read_at is None:
                event.read_at = now
        await db.commit()
        return NotificationUnreadCountRead(count=0)

    async def cleanup_expired_events(
        self, db: AsyncSession, *, retention_days: int | None = None
    ) -> int:
        days = retention_days if retention_days is not None else settings.NOTIFICATION_RETENTION_DAYS
        if days <= 0:
            raise ValueError("notification retention days must be positive")
        cutoff = utc_now_naive() - timedelta(days=days)
        deleted = await self.repository.delete_older_than(db, cutoff)
        if deleted:
            await db.commit()
        return deleted

    async def _event_read(
        self, db: AsyncSession, event: NotificationEvent
    ) -> NotificationEventRead:
        return NotificationEventRead(
            notification_id=event.notification_uuid,
            type=event.type,
            title=event.title,
            body=event.body,
            resource_type=event.resource_type,
            resource_id=event.resource_id,
            score_id=event.score_id,
            actor=await self._actor(db, event.actor_user_id),
            data=event.data,
            read_at=event.read_at,
            created_at=event.created_at,
        )

    async def _actor(
        self, db: AsyncSession, user_id: int | None
    ) -> NotificationActorRead | None:
        if user_id is None:
            return None
        user = await db.get(User, user_id)
        if user is None:
            return None
        return NotificationActorRead(
            display_name=user.display_name,
            email=user.email,
            avatar_url=user.avatar_url,
        )

    async def _score_notification_recipients(
        self, db: AsyncSession, score: Score
    ) -> list[int]:
        score_id = score.id
        if score_id is None:
            return []
        rows = await db.execute(
            select(ScoreMembership.user_id).where(
                ScoreMembership.score_id == score_id,
                col(ScoreMembership.revoked_at).is_(None),
            )
        )
        recipients = {score.owner_user_id}
        recipients.update(int(user_id) for user_id in rows.scalars().all())
        return sorted(recipients)
