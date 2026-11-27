"""Bounded credential erasure through closed-account database authority."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session


def erase_authentication_history(db: Session, user_id: int, *, limit: int) -> bool:
    return bool(db.scalar(select(func.nv_erase_closed_authentication_history(user_id, limit))))
