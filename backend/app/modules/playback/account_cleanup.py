"""Bounded requester anonymization; foreign-owner work and history remain intact."""

from sqlalchemy import select, update
from sqlalchemy.orm import Session
from app.db.models import PlaybackOutbox


def erase_playback_requester_links(db: Session, user_id: int, *, limit: int) -> bool:
    ids = list(
        db.scalars(
            select(PlaybackOutbox.id)
            .where(PlaybackOutbox.requested_by_user_id == user_id)
            .order_by(PlaybackOutbox.id)
            .limit(limit)
        )
    )
    if not ids:
        return False
    db.execute(
        update(PlaybackOutbox)
        .where(PlaybackOutbox.id.in_(ids), PlaybackOutbox.requested_by_user_id == user_id)
        .values(requested_by_user_id=None)
    )
    return True
