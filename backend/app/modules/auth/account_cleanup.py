"""Bounded erasure of a closed principal's authentication credentials."""

from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from app.db.models.auth import AuthToken, RefreshToken


def erase_authentication_history(db: Session, user_id: int, *, limit: int) -> bool:
    ids = list(
        db.scalars(
            select(AuthToken.id)
            .where(AuthToken.user_id == user_id)
            .order_by(AuthToken.id)
            .limit(limit)
        )
    )
    if ids:
        db.execute(delete(AuthToken).where(AuthToken.id.in_(ids)))
        return True
    ids = list(
        db.scalars(
            select(RefreshToken.id)
            .where(RefreshToken.user_id == user_id)
            .order_by(RefreshToken.id)
            .limit(limit)
        )
    )
    if ids:
        db.execute(delete(RefreshToken).where(RefreshToken.id.in_(ids)))
        return True
    return False
