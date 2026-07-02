from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import NotificationEvent
from app.modules.notifications.service import NotificationTypes
from app.utils.timezone import utc_now_naive

logger = logging.getLogger(__name__)


class SyncNotificationService:
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
    ) -> NotificationEvent | None:
        if actor_user_id == recipient_user_id:
            return None
        if dedupe_key:
            existing = self.by_dedupe_key(db, dedupe_key)
            if existing:
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
            created_at=utc_now_naive(),
        )
        db.add(event)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if dedupe_key:
                return self.by_dedupe_key(db, dedupe_key)
            raise
        db.refresh(event)
        return event

    def create_event_best_effort(self, db: Session, **kwargs) -> NotificationEvent | None:
        try:
            return self.create_event(db, **kwargs)
        except Exception:
            db.rollback()
            logger.exception("Failed to create notification event", extra={"type": kwargs.get("type")})
            return None

    @staticmethod
    def by_dedupe_key(db: Session, dedupe_key: str) -> NotificationEvent | None:
        return db.query(NotificationEvent).filter_by(dedupe_key=dedupe_key).one_or_none()

    def notify_processing_completed_best_effort(
        self,
        db: Session,
        *,
        job_uuid: str,
        recipient_user_id: int,
        title: str | None,
    ) -> None:
        display_title = title or "Your score"
        self.create_event_best_effort(
            db,
            recipient_user_id=recipient_user_id,
            actor_user_id=None,
            type=NotificationTypes.PROCESSING_COMPLETED,
            resource_type="job",
            resource_id=job_uuid,
            score_id=None,
            title="Processing complete",
            body=f"{display_title} is ready for review.",
            dedupe_key=f"{NotificationTypes.PROCESSING_COMPLETED}:{job_uuid}:{recipient_user_id}",
            data={
                "job_id": job_uuid,
                "job_title": title,
            },
        )

    def notify_processing_failed_best_effort(
        self,
        db: Session,
        *,
        job_uuid: str,
        recipient_user_id: int,
        code: str | None,
        error_type: str | None,
    ) -> None:
        self.create_event_best_effort(
            db,
            recipient_user_id=recipient_user_id,
            actor_user_id=None,
            type=NotificationTypes.PROCESSING_FAILED,
            resource_type="job",
            resource_id=job_uuid,
            title="Processing failed",
            body="We could not finish processing your score.",
            dedupe_key=f"{NotificationTypes.PROCESSING_FAILED}:{job_uuid}:{recipient_user_id}",
            data={
                "job_id": job_uuid,
                "code": code,
                "error_type": error_type,
            },
        )


sync_notification_service = SyncNotificationService()
