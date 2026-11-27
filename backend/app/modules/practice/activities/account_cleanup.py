"""User-owned lightweight practice activity erasure, independent of shared Scores."""

from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from app.db.models.practice_activity import PracticeActivity


def erase_account_activities(db: Session, user_id: int, *, limit: int) -> bool:
    ids = list(
        db.scalars(
            select(PracticeActivity.id)
            .where(PracticeActivity.user_id == user_id)
            .order_by(PracticeActivity.id)
            .limit(limit)
        )
    )
    if not ids:
        return False
    db.execute(delete(PracticeActivity).where(PracticeActivity.id.in_(ids)))
    return True
