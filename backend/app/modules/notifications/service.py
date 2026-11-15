from __future__ import annotations
from datetime import datetime, timedelta
from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.modules.account.avatar_presentation import avatar_url_for_user
from app.core.config import settings
from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import Notification, NotificationKind, RealtimeChangeKind, User
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.schemas import (
    NotificationActorRead,
    NotificationRead,
    NotificationUnreadCountRead,
)
from app.shared.constants import ErrorCode
from app.modules.realtime.publisher import publish_change
from app.utils.timezone import utc_now_naive

notification_read_adapter: TypeAdapter[NotificationRead] = TypeAdapter(NotificationRead)


class NotificationService:
    def __init__(self, repository: NotificationRepository | None = None) -> None:
        self.repository = repository or NotificationRepository()

    def _admit(self, db: Session, notification: Notification) -> Notification:
        if notification.dedupe_key:
            existing = self.repository.by_dedupe_key(db, notification.dedupe_key)
            if existing is not None:
                return existing
        db.add(notification)
        db.flush()
        publish_change(
            db,
            recipient_user_id=notification.recipient_user_id,
            kind=RealtimeChangeKind.NOTIFICATIONS_CHANGED,
            notification_id=notification.notification_uuid,
        )
        return notification

    def admit_score_invite_response(
        self,
        db: Session,
        *,
        recipient_user_id: int,
        actor_user_id: int,
        accepted: bool,
        invite_id: str,
        score_id: str,
        score_title: str,
        created_at: datetime,
    ) -> Notification | None:
        if actor_user_id == recipient_user_id:
            return None
        kind = (
            NotificationKind.SCORE_INVITE_ACCEPTED
            if accepted
            else NotificationKind.SCORE_INVITE_DECLINED
        )
        return self._admit(
            db,
            Notification(
                recipient_user_id=recipient_user_id,
                actor_user_id=actor_user_id,
                kind=kind,
                invite_id=invite_id,
                score_id=score_id,
                score_title_snapshot=score_title,
                created_at=created_at,
                dedupe_key=f"{kind}:{invite_id}:{recipient_user_id}",
            ),
        )

    def admit_score_version_created(
        self,
        db: Session,
        *,
        recipient_user_id: int,
        actor_user_id: int,
        score_id: str,
        revision_id: str,
        score_title: str,
        created_at: datetime,
    ) -> Notification | None:
        if actor_user_id == recipient_user_id:
            return None
        return self._admit(
            db,
            Notification(
                recipient_user_id=recipient_user_id,
                actor_user_id=actor_user_id,
                kind=NotificationKind.SCORE_VERSION_CREATED,
                score_id=score_id,
                revision_id=revision_id,
                score_title_snapshot=score_title,
                created_at=created_at,
                dedupe_key=f"score.version.created:{revision_id}:{recipient_user_id}",
            ),
        )

    def admit_import_completed(
        self,
        db: Session,
        *,
        recipient_user_id: int,
        import_job_id: str,
        job_title: str | None,
        created_at: datetime,
    ) -> Notification:
        return self._admit(
            db,
            Notification(
                recipient_user_id=recipient_user_id,
                kind=NotificationKind.IMPORT_COMPLETED,
                import_job_id=import_job_id,
                job_title_snapshot=job_title,
                created_at=created_at,
                dedupe_key=f"import.completed:{import_job_id}:{recipient_user_id}",
            ),
        )

    def admit_import_failed(
        self,
        db: Session,
        *,
        recipient_user_id: int,
        import_job_id: str,
        job_title: str | None,
        created_at: datetime,
    ) -> Notification:
        return self._admit(
            db,
            Notification(
                recipient_user_id=recipient_user_id,
                kind=NotificationKind.IMPORT_FAILED,
                import_job_id=import_job_id,
                job_title_snapshot=job_title,
                created_at=created_at,
                dedupe_key=f"import.failed:{import_job_id}:{recipient_user_id}",
            ),
        )

    def list_for_user(
        self, db: Session, user_id: int, *, limit: int = 50
    ) -> list[NotificationRead]:
        user = db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        notifications = self.repository.list_for_user(db, user_id, limit=limit)
        return [self._notification_read(db, notification) for notification in notifications]

    def unread_count(self, db: Session, user_id: int) -> NotificationUnreadCountRead:
        user = db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        return NotificationUnreadCountRead(count=self.repository.unread_count(db, user_id))

    def mark_read(self, db: Session, notification_uuid: str, user_id: int) -> NotificationRead:
        notification = db.scalar(
            select(Notification)
            .where(Notification.notification_uuid == notification_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if not notification:
            raise ResourceNotFoundException(
                "notification", notification_uuid, ErrorCode.NOTIFICATION_NOT_FOUND
            )
        if notification.recipient_user_id != user_id:
            raise ResourceNotFoundException(
                "notification", notification_uuid, ErrorCode.NOTIFICATION_NOT_FOUND
            )
        if notification.read_at is None:
            notification.read_at = utc_now_naive()
            publish_change(
                db,
                recipient_user_id=user_id,
                kind=RealtimeChangeKind.NOTIFICATIONS_CHANGED,
                notification_id=notification.notification_uuid,
            )
            db.commit()
            db.refresh(notification)
        return self._notification_read(db, notification)

    def mark_all_read(self, db: Session, user_id: int) -> NotificationUnreadCountRead:
        now = utc_now_naive()
        changed = self.repository.mark_all_read_for_user(db, user_id, read_at=now)
        if changed:
            publish_change(
                db, recipient_user_id=user_id, kind=RealtimeChangeKind.NOTIFICATIONS_CHANGED
            )
        db.commit()
        return NotificationUnreadCountRead(count=self.repository.unread_count(db, user_id))

    def cleanup_expired_notifications(
        self, db: Session, *, retention_days: int | None = None
    ) -> int:
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

    def _notification_read(self, db: Session, row: Notification) -> NotificationRead:
        common = dict(
            notification_id=row.notification_uuid, read_at=row.read_at, created_at=row.created_at
        )
        fields = {**common, "kind": row.kind}
        if row.kind in {
            NotificationKind.SCORE_INVITE_ACCEPTED,
            NotificationKind.SCORE_INVITE_DECLINED,
            NotificationKind.SCORE_VERSION_CREATED,
        }:
            fields.update(
                actor=self._actor(db, row.actor_user_id),
                score_id=row.score_id,
                score_title=row.score_title_snapshot,
            )
            if row.kind == NotificationKind.SCORE_VERSION_CREATED:
                fields["revision_id"] = row.revision_id
            else:
                fields["invite_id"] = row.invite_id
        else:
            fields.update(job_id=row.import_job_id, job_title=row.job_title_snapshot)
            if row.kind == NotificationKind.IMPORT_COMPLETED:
                fields.update(score_id=row.score_id, score_title=row.score_title_snapshot)
        return notification_read_adapter.validate_python(fields)

    def _actor(self, db: Session, user_id: int | None) -> NotificationActorRead | None:
        user = db.get(User, user_id) if user_id is not None else None
        if user is None:
            return None
        return NotificationActorRead(
            display_name=user.display_name, email=user.email, avatar_url=avatar_url_for_user(user)
        )


notification_service = NotificationService()
