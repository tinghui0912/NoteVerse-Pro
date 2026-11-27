from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete, select, func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import RealtimeChange
from app.shared.time import utc_now
from app.modules.realtime.stream_state import lock_stream_state


RETENTION_RECIPIENT_BATCH_SIZE = 100


class RealtimeMaintenanceService:
    @staticmethod
    def retention_cutoff(*, retention_days: int | None = None) -> datetime:
        days = (
            retention_days if retention_days is not None else settings.REALTIME_EVENT_RETENTION_DAYS
        )
        if days <= 0:
            raise ValueError("realtime change retention days must be positive")
        return utc_now() - timedelta(days=days)

    def expired_recipient_ids(self, db: Session, *, cutoff: datetime) -> list[int]:
        return list(
            db.scalars(
                select(RealtimeChange.recipient_user_id)
                .where(RealtimeChange.created_at < cutoff)
                .distinct()
                .order_by(RealtimeChange.recipient_user_id)
                .limit(RETENTION_RECIPIENT_BATCH_SIZE)
            )
        )

    def cleanup_recipient(self, db: Session, recipient_user_id: int, *, cutoff: datetime) -> int:
        state = lock_stream_state(db, recipient_user_id)
        if state is None:
            raise RuntimeError("Realtime changes require their recipient stream state")
        expired = (
            RealtimeChange.recipient_user_id == recipient_user_id,
            RealtimeChange.created_at < cutoff,
        )
        maximum = db.scalar(select(func.max(RealtimeChange.sequence)).where(*expired))
        if maximum is None:
            return 0
        state.replay_floor_sequence = max(state.replay_floor_sequence, maximum)
        state.updated_at = utc_now()
        result = db.execute(delete(RealtimeChange).where(*expired))
        db.flush()
        return int(result.rowcount or 0)


realtime_maintenance_service = RealtimeMaintenanceService()
