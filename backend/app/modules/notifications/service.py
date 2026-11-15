from __future__ import annotations
from app.modules.account.avatar_presentation import avatar_url_for_user

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import NotificationEvent, User
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.schemas import (
    NotificationActorRead,
    NotificationEventRead,
    NotificationUnreadCountRead,
)
from app.shared.constants import ErrorCode
from app.modules.realtime.publisher import RealtimeEventTypes, publish_event
from app.utils.timezone import utc_now_naive

PUBLIC_NOTIFICATION_DATA_KEYS = frozenset(
    {
        "job_id",
        "job_title",
        "score_id",
        "score_title",
    }
)


def public_notification_data(data: dict[str, Any] | None) -> dict[str, Any]:
    if not data:
        return {}
    return {key: value for key, value in data.items() if key in PUBLIC_NOTIFICATION_DATA_KEYS}


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

    def admit_event(
        self,
        db: Session,
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
        created_at: datetime | None = None,
    ) -> NotificationEvent | None:
        """Admit notification history and its wake-up in the caller's transaction."""
        if actor_user_id == recipient_user_id:
            return None
        if dedupe_key:
            existing = self.repository.by_dedupe_key(db, dedupe_key)
            if existing is not None:
                return existing
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
            created_at=created_at if created_at is not None else utc_now_naive(),
        )
        db.add(event)
        db.flush()
        publish_event(
            db,
            recipient_user_id=recipient_user_id,
            type=RealtimeEventTypes.NOTIFICATION_CREATED,
            resource_type="notification",
            resource_id=event.notification_uuid,
            score_id=score_id,
            payload={},
        )
        return event

    def create_event(
        self,
        db: Session,
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
        """Own a standalone notification admission transaction."""
        try:
            event = self.admit_event(
                db,
                recipient_user_id=recipient_user_id,
                actor_user_id=actor_user_id,
                type=type,
                resource_type=resource_type,
                title=title,
                body=body,
                resource_id=resource_id,
                score_id=score_id,
                data=data,
                dedupe_key=dedupe_key,
            )
            if event is None:
                return None
            db.commit()
        except IntegrityError:
            db.rollback()
            if dedupe_key:
                existing = self.repository.by_dedupe_key(db, dedupe_key)
                if existing is not None:
                    return self._event_read(db, existing)
            raise
        return self._event_read(db, event)

    def list_for_user(
        self, db: Session, user_id: int, *, limit: int = 50
    ) -> list[NotificationEventRead]:
        user = db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        events = self.repository.list_for_user(db, user_id, limit=limit)
        return [self._event_read(db, event) for event in events]

    def unread_count(self, db: Session, user_id: int) -> NotificationUnreadCountRead:
        user = db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        return NotificationUnreadCountRead(count=self.repository.unread_count(db, user_id))

    def mark_read(self, db: Session, notification_uuid: str, user_id: int) -> NotificationEventRead:
        event = self.repository.by_uuid(db, notification_uuid)
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
            db.commit()
            db.refresh(event)
        return self._event_read(db, event)

    def mark_all_read(self, db: Session, user_id: int) -> NotificationUnreadCountRead:
        now = utc_now_naive()
        self.repository.mark_all_read_for_user(db, user_id, read_at=now)
        db.commit()
        return NotificationUnreadCountRead(count=self.repository.unread_count(db, user_id))

    def cleanup_expired_events(self, db: Session, *, retention_days: int | None = None) -> int:
        days = (
            retention_days if retention_days is not None else settings.NOTIFICATION_RETENTION_DAYS
        )
        if days <= 0:
            raise ValueError("notification retention days must be positive")
        cutoff = utc_now_naive() - timedelta(days=days)
        deleted = self.repository.delete_older_than(db, cutoff)
        if deleted:
            db.commit()
        return deleted

    def _event_read(self, db: Session, event: NotificationEvent) -> NotificationEventRead:
        return NotificationEventRead(
            notification_id=event.notification_uuid,
            type=event.type,
            title=event.title,
            body=event.body,
            score_id=event.score_id,
            actor=self._actor(db, event.actor_user_id),
            data=public_notification_data(event.data),
            read_at=event.read_at,
            created_at=event.created_at,
        )

    def _actor(self, db: Session, user_id: int | None) -> NotificationActorRead | None:
        if user_id is None:
            return None
        user = db.get(User, user_id)
        if user is None:
            return None
        return NotificationActorRead(
            display_name=user.display_name,
            email=user.email,
            avatar_url=avatar_url_for_user(user),
        )


notification_service = NotificationService()
