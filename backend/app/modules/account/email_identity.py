"""Serialize email-address identity admission, including an absent User row.

Transaction-scoped PostgreSQL locks retain no address history and grant no access.
They coordinate invitation creation with registration, identity change and closure.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement


def _email_identity_key(email: str) -> ColumnElement[int]:
    return func.hashtextextended("noteverse:email-identity:" + email.strip().lower(), 0)


def lock_email_identity(db: Session, email: str) -> None:
    db.execute(select(func.pg_advisory_xact_lock(_email_identity_key(email))))


def try_lock_email_identity(db: Session, email: str) -> bool:
    """Exclusive-User erasure never waits on a creator retaining User KEY SHARE."""
    return db.scalar(select(func.pg_try_advisory_xact_lock(_email_identity_key(email)))) is True
