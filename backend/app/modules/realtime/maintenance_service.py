from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import RealtimeEvent
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class RealtimeMaintenanceResult:
    expired_events_deleted: int = 0


class RealtimeMaintenanceService:
    def run(self, db: Session) -> RealtimeMaintenanceResult:
        return RealtimeMaintenanceResult(
            expired_events_deleted=self.cleanup_expired_events(db)
        )

    def cleanup_expired_events(self, db: Session, *, retention_days: int | None = None) -> int:
        days = retention_days if retention_days is not None else settings.REALTIME_EVENT_RETENTION_DAYS
        if days <= 0:
            raise ValueError("realtime event retention days must be positive")
        cutoff = utc_now_naive() - timedelta(days=days)
        result = db.execute(delete(RealtimeEvent).where(RealtimeEvent.created_at < cutoff))
        deleted = int(result.rowcount or 0)
        if deleted:
            db.commit()
        return deleted


realtime_maintenance_service = RealtimeMaintenanceService()
