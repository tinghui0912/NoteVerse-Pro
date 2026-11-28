"""Authentication owns credential-mail source identities, never recipient inference."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models.auth import AuthToken, EmailChangeRequest
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
    from sqlalchemy import func

    if kind not in {
        MailSourceKind.ACCOUNT,
        MailSourceKind.AUTH_TOKEN,
        MailSourceKind.EMAIL_CHANGE,
        MailSourceKind.REGISTRATION,
    }:
        raise ValueError("Not an authentication mail source")
    return bool(db.scalar(select(func.nv_authentication_mail_source_active(kind.value, source_id))))
