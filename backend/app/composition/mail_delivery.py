"""Explicit domain-source admission before mail claim and provider handoff."""

from sqlalchemy import select, literal
from sqlalchemy.orm import Session
from app.db.models.mail_outbox import MailOutbox, MailSourceKind
from app.modules.auth.mail_lifecycle import authentication_mail_source_active
from app.modules.collaboration.mail_lifecycle import invitation_mail_source_active
from app.modules.mail.outbox_service import cancel_source_mail


def validate_mail_source(db: Session, outbox_uuid: str) -> bool:
    row = db.execute(
        select(MailOutbox.source_kind, MailOutbox.source_id).where(
            MailOutbox.outbox_uuid == outbox_uuid
        )
    ).one_or_none()
    if row is None or row.source_kind is None or row.source_id is None:
        return False
    kind = MailSourceKind(row.source_kind)
    active = (
        invitation_mail_source_active(db, row.source_id)
        if kind == MailSourceKind.SCORE_INVITE
        else authentication_mail_source_active(db, kind, row.source_id)
    )
    if not active:
        cancel_source_mail(db, kind, select(literal(row.source_id)))
    return active
