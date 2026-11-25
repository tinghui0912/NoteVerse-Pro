"""Closed-recipient private replay erasure; no transport or publication policy."""

from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from app.db.models.realtime import RealtimeChange


def erase_recipient_replay(db: Session, user_id: int, *, limit: int) -> bool:
    ids = list(
        db.scalars(
            select(RealtimeChange.id)
            .where(RealtimeChange.recipient_user_id == user_id)
            .order_by(RealtimeChange.id)
            .limit(limit)
        )
    )
    if not ids:
        return False
    db.execute(delete(RealtimeChange).where(RealtimeChange.id.in_(ids)))
    return True
