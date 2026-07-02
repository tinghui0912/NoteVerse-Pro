from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import NotificationEvent
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class NotificationMaintenanceResult:
    expired_notifications_deleted: int = 0


class NotificationMaintenanceService:
    def run(self, db: Session) -> NotificationMaintenanceResult:
        return NotificationMaintenanceResult(
            expired_notifications_deleted=self.cleanup_expired_events(db)
        )

    def cleanup_expired_events(self, db: Session, *, retention_days: int | None = None) -> int:
        days = retention_days if retention_days is not None else settings.NOTIFICATION_RETENTION_DAYS
        if days <= 0:
            raise ValueError("notification retention days must be positive")
        cutoff = utc_now_naive() - timedelta(days=days)
        result = db.execute(delete(NotificationEvent).where(NotificationEvent.created_at < cutoff))
        deleted = int(result.rowcount or 0)
        if deleted:
            db.commit()
        return deleted


notification_maintenance_service = NotificationMaintenanceService()
