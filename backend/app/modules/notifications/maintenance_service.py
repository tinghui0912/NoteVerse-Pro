from __future__ import annotations


from app.platform.config.notification_lifecycle import NotificationLifecycleSettings

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db.models import Notification
from app.shared.time import utc_now


@dataclass(frozen=True)
class NotificationMaintenanceResult:
    expired_notifications_deleted: int = 0


class NotificationMaintenanceService:
    def __init__(self, *, config: NotificationLifecycleSettings) -> None:
        self.config = config

    def run(self, db: Session) -> NotificationMaintenanceResult:
        return NotificationMaintenanceResult(
            expired_notifications_deleted=self.cleanup_expired_notifications(db)
        )

    def cleanup_expired_notifications(
        self, db: Session, *, retention_days: int | None = None
    ) -> int:
        days = (
            retention_days
            if retention_days is not None
            else self.config.NOTIFICATION_RETENTION_DAYS
        )
        if days <= 0:
            raise ValueError("notification retention days must be positive")
        cutoff = utc_now() - timedelta(days=days)
        result = db.execute(delete(Notification).where(Notification.created_at < cutoff))
        deleted = int(result.rowcount or 0)
        return deleted
