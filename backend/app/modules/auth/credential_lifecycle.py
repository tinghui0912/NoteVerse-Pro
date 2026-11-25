"""User-first credential serialization with account closure; no outer commits."""

from datetime import datetime
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from app.db.models.auth import AuthToken, EmailChangeRequest
from app.db.models.user import User
from app.core.exceptions import ValidationException
from app.shared.error_codes import CustomerErrorCode


def lock_credential_user(
    db: Session,
    user_id: int,
    *,
    invalid_code: CustomerErrorCode = CustomerErrorCode.TOKEN_INVALID_EXPIRED,
) -> User:
    # NO KEY UPDATE serializes credential commands and closure without blocking
    # existing KEY SHARE resource admission or unrelated FK insertions.
    user = db.execute(
        select(User)
        .where(User.id == user_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if user is None or not user.is_active or user.deleted_at is not None:
        raise ValidationException(code=invalid_code, field="token")
    return user


def invalidate_user_credentials(db: Session, user_id: int, *, now: datetime) -> None:
    """Caller holds the User lock. History is erased later in bounded batches."""
    db.execute(
        update(AuthToken)
        .where(AuthToken.user_id == user_id, AuthToken.__table__.c.used_at.is_(None))
        .values(used_at=now)
    )
    db.execute(
        update(EmailChangeRequest)
        .where(
            EmailChangeRequest.user_id == user_id,
            EmailChangeRequest.__table__.c.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
