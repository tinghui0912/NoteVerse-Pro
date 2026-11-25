"""Bounded removal of actor links while preserving another owner's revision history."""

from sqlalchemy import select, update
from sqlalchemy.orm import Session
from app.db.models import (
    ScoreRevision,
    ScoreRevisionEvent,
    ScoreRevisionNote,
    ScoreRevisionRenderOutbox,
)


def erase_revision_actor_links(db: Session, user_id: int, *, limit: int) -> bool:
    revision_ids = list(
        db.scalars(
            select(ScoreRevision.id)
            .where(ScoreRevision.created_by_user_id == user_id)
            .order_by(ScoreRevision.id)
            .limit(limit)
        )
    )
    if revision_ids:
        db.execute(
            update(ScoreRevision)
            .where(ScoreRevision.id.in_(revision_ids), ScoreRevision.created_by_user_id == user_id)
            .values(created_by_user_id=None)
        )
        return True
    event_ids = list(
        db.scalars(
            select(ScoreRevisionEvent.id)
            .where(ScoreRevisionEvent.actor_user_id == user_id)
            .order_by(ScoreRevisionEvent.id)
            .limit(limit)
        )
    )
    if event_ids:
        db.execute(
            update(ScoreRevisionEvent)
            .where(
                ScoreRevisionEvent.id.in_(event_ids), ScoreRevisionEvent.actor_user_id == user_id
            )
            .values(actor_user_id=None)
        )
        return True
    note_ids = list(
        db.scalars(
            select(ScoreRevisionNote.id)
            .where(ScoreRevisionNote.author_user_id == user_id)
            .order_by(ScoreRevisionNote.id)
            .limit(limit)
        )
    )
    if note_ids:
        db.execute(
            update(ScoreRevisionNote)
            .where(ScoreRevisionNote.id.in_(note_ids), ScoreRevisionNote.author_user_id == user_id)
            .values(author_user_id=None)
        )
        return True
    outbox_ids = list(
        db.scalars(
            select(ScoreRevisionRenderOutbox.id)
            .where(ScoreRevisionRenderOutbox.requested_by_user_id == user_id)
            .order_by(ScoreRevisionRenderOutbox.id)
            .limit(limit)
        )
    )
    if outbox_ids:
        db.execute(
            update(ScoreRevisionRenderOutbox)
            .where(
                ScoreRevisionRenderOutbox.id.in_(outbox_ids),
                ScoreRevisionRenderOutbox.requested_by_user_id == user_id,
            )
            .values(requested_by_user_id=None)
        )
        return True
    return False
