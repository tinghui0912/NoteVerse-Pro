from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, select, func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import RealtimeChange
from app.utils.timezone import utc_now_naive
from app.modules.realtime.stream_state import lock_stream_state


@dataclass(frozen=True)
class RealtimeMaintenanceResult:
    expired_changes_deleted: int = 0


class RealtimeMaintenanceService:
    def run(self, db: Session) -> RealtimeMaintenanceResult:
        return RealtimeMaintenanceResult(expired_changes_deleted=self.cleanup_expired_changes(db))

    def cleanup_expired_changes(self, db: Session, *, retention_days: int | None = None) -> int:
        days = (
            retention_days if retention_days is not None else settings.REALTIME_EVENT_RETENTION_DAYS
        )
        if days <= 0:
            raise ValueError("realtime change retention days must be positive")
        cutoff = utc_now_naive() - timedelta(days=days)
        state = lock_stream_state(db)
        maximum = db.scalar(
            select(func.max(RealtimeChange.sequence)).where(RealtimeChange.created_at < cutoff)
        )
        if maximum is None:
            db.commit()
            return 0
        state.replay_floor_sequence = max(state.replay_floor_sequence, maximum)
        state.updated_at = utc_now_naive()
        result = db.execute(delete(RealtimeChange).where(RealtimeChange.created_at < cutoff))
        deleted = int(result.rowcount or 0)
        db.commit()
        return deleted


realtime_maintenance_service = RealtimeMaintenanceService()
