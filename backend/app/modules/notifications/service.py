from __future__ import annotations
from datetime import datetime
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import Notification, NotificationKind, User
from app.shared.realtime import RealtimeChangeKind
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.read_model import NotificationReadModel
from app.shared.feed_cursor import decode_cursor, encode_cursor
from app.modules.notifications.schemas import (
    NotificationRead,
    NotificationUnreadCountRead,
    NotificationListRead,
)
from app.shared.error_codes import CustomerErrorCode
from app.modules.realtime.publisher import publish_change
from app.shared.time import utc_now


class NotificationService:
    def erase_recipient_history(self, db: Session, user_id: int) -> None:
        """User erasure removes private history; foreign actor snapshots survive."""
        db.execute(delete(Notification).where(Notification.recipient_user_id == user_id))

    def __init__(self, repository: NotificationRepository | None = None) -> None:
        self.repository = repository or NotificationRepository()

    def _admit(self, db: Session, notification: Notification) -> Notification:
        if notification.dedupe_key is not None:
            notification, created = self.repository.admit_deduplicated(db, notification)
            if not created:
                return notification
        else:
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
        score_display_title: str,
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
                score_display_title_snapshot=score_display_title,
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
        score_display_title: str,
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
                score_display_title_snapshot=score_display_title,
                created_at=created_at,
                dedupe_key=f"score.version.created:{revision_id}:{recipient_user_id}",
            ),
        )

    def admit_import_ready_for_review(
        self,
        db: Session,
        *,
        recipient_user_id: int,
        import_job_id: str,
        import_display_title: str | None,
        created_at: datetime,
    ) -> Notification:
        return self._admit(
            db,
            Notification(
                recipient_user_id=recipient_user_id,
                kind=NotificationKind.IMPORT_READY_FOR_REVIEW,
                import_job_id=import_job_id,
                import_display_title_snapshot=import_display_title,
                created_at=created_at,
                dedupe_key=f"import.ready_for_review:{import_job_id}:{recipient_user_id}",
            ),
        )

    def admit_import_failed(
        self,
        db: Session,
        *,
        recipient_user_id: int,
        import_job_id: str,
        import_display_title: str | None,
        created_at: datetime,
    ) -> Notification:
        return self._admit(
            db,
            Notification(
                recipient_user_id=recipient_user_id,
                kind=NotificationKind.IMPORT_FAILED,
                import_job_id=import_job_id,
                import_display_title_snapshot=import_display_title,
                created_at=created_at,
                dedupe_key=f"import.failed:{import_job_id}:{recipient_user_id}",
            ),
        )

    def list_for_user(
        self, db: Session, user_id: int, *, limit: int = 50, cursor: str | None = None
    ) -> NotificationListRead:
        before = decode_cursor(cursor, collection="notifications", scope=str(user_id))
        if db.scalar(select(User.id).where(User.id == user_id)) is None:
            raise UnauthorizedException(CustomerErrorCode.NO_ACCESS)
        rows = self.repository.list_for_user(db, user_id, limit=limit + 1, before=before)
        page = rows[:limit]
        next_cursor = (
            encode_cursor("notifications", str(user_id), page[-1].created_at, page[-1].id)
            if len(rows) > limit
            else None
        )
        return NotificationListRead(
            items=NotificationReadModel().notification_page(db, page), next_cursor=next_cursor
        )

    def unread_count(self, db: Session, user_id: int) -> NotificationUnreadCountRead:
        user = db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(CustomerErrorCode.NO_ACCESS)
        return NotificationUnreadCountRead(count=self.repository.unread_count(db, user_id))

    def mark_read(self, db: Session, notification_uuid: str, user_id: int) -> NotificationRead:
        from app.modules.account.resource_admission import lock_active_resource_user

        lock_active_resource_user(db, user_id)
        notification = db.scalar(
            select(Notification)
            .where(Notification.notification_uuid == notification_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if not notification:
            raise ResourceNotFoundException(
                "notification", notification_uuid, CustomerErrorCode.NOTIFICATION_NOT_FOUND
            )
        if notification.recipient_user_id != user_id:
            raise ResourceNotFoundException(
                "notification", notification_uuid, CustomerErrorCode.NOTIFICATION_NOT_FOUND
            )
        if notification.read_at is None:
            notification.read_at = utc_now()
            publish_change(
                db,
                recipient_user_id=user_id,
                kind=RealtimeChangeKind.NOTIFICATIONS_CHANGED,
                notification_id=notification.notification_uuid,
            )
            db.flush()
        return self._notification_read(db, notification)

    def mark_all_read(self, db: Session, user_id: int) -> NotificationUnreadCountRead:
        from app.modules.account.resource_admission import lock_active_resource_user

        lock_active_resource_user(db, user_id)
        now = utc_now()
        changed = self.repository.mark_all_read_for_user(db, user_id, read_at=now)
        if changed:
            publish_change(
                db, recipient_user_id=user_id, kind=RealtimeChangeKind.NOTIFICATIONS_CHANGED
            )
        db.flush()
        return NotificationUnreadCountRead(count=self.repository.unread_count(db, user_id))

    def _notification_read(self, db: Session, row: Notification) -> NotificationRead:
        return NotificationReadModel().notification_page(db, [row])[0]


notification_service = NotificationService()
