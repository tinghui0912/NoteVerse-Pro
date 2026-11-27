"""Authentication owns credential-mail source identities, never recipient inference."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models.auth import AuthToken, EmailChangeRequest, PendingRegistration
from app.db.models.user import User
from app.db.models.mail_outbox import MailSourceKind
from app.modules.mail.outbox_service import cancel_source_mail


def cancel_user_authentication_mail(db: Session, user_id: int) -> None:
    cancel_source_mail(db, MailSourceKind.ACCOUNT, select(User.id).where(User.id == user_id))
    cancel_source_mail(
        db, MailSourceKind.AUTH_TOKEN, select(AuthToken.id).where(AuthToken.user_id == user_id)
    )
    cancel_source_mail(
        db,
        MailSourceKind.EMAIL_CHANGE,
        select(EmailChangeRequest.id).where(EmailChangeRequest.user_id == user_id),
    )


def authentication_mail_source_active(db: Session, kind: MailSourceKind, source_id: int) -> bool:
    from app.shared.time import utc_now

    active = (User.is_active.is_(True), User.deleted_at.is_(None))
    if kind == MailSourceKind.ACCOUNT:
        return db.scalar(select(User.id).where(User.id == source_id, *active)) is not None
    if kind == MailSourceKind.AUTH_TOKEN:
        return (
            db.scalar(
                select(AuthToken.id)
                .join(User, User.id == AuthToken.user_id)
                .where(
                    AuthToken.id == source_id,
                    AuthToken.__table__.c.used_at.is_(None),
                    AuthToken.expires_at > utc_now(),
                    *active,
                )
            )
            is not None
        )
    if kind == MailSourceKind.EMAIL_CHANGE:
        return (
            db.scalar(
                select(EmailChangeRequest.id)
                .join(User, User.id == EmailChangeRequest.user_id)
                .where(
                    EmailChangeRequest.id == source_id,
                    EmailChangeRequest.__table__.c.consumed_at.is_(None),
                    EmailChangeRequest.expires_at > utc_now(),
                    *active,
                )
            )
            is not None
        )
    if kind == MailSourceKind.REGISTRATION:
        return (
            db.scalar(
                select(PendingRegistration.id).where(
                    PendingRegistration.id == source_id,
                    PendingRegistration.__table__.c.consumed_at.is_(None),
                    PendingRegistration.expires_at > utc_now(),
                )
            )
            is not None
        )
    raise ValueError("Not an authentication mail source")
