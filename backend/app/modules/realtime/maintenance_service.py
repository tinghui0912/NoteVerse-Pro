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


RETENTION_RECIPIENT_BATCH_SIZE = 100


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
        recipients = db.scalars(
            select(RealtimeChange.recipient_user_id)
            .where(RealtimeChange.created_at < cutoff)
            .distinct()
            .order_by(RealtimeChange.recipient_user_id)
            .limit(RETENTION_RECIPIENT_BATCH_SIZE)
        ).all()
        deleted = 0
        for recipient_user_id in recipients:
            state = lock_stream_state(db, recipient_user_id)
            if state is None:
                raise RuntimeError("Realtime changes require their recipient stream state")
            expired = (
                RealtimeChange.recipient_user_id == recipient_user_id,
                RealtimeChange.created_at < cutoff,
            )
            maximum = db.scalar(select(func.max(RealtimeChange.sequence)).where(*expired))
            if maximum is not None:
                state.replay_floor_sequence = max(state.replay_floor_sequence, maximum)
                state.updated_at = utc_now_naive()
                result = db.execute(delete(RealtimeChange).where(*expired))
                deleted += int(result.rowcount or 0)
            db.commit()
        if not recipients:
            db.commit()
        return deleted


realtime_maintenance_service = RealtimeMaintenanceService()
