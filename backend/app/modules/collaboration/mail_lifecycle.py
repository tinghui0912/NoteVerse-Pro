"""Collaboration invalidates invitation deliveries by invitation/Score identity."""

from collections.abc import Sequence
from sqlalchemy import select, or_, exists
from sqlalchemy.orm import Session
from app.db.models import Score, ScoreInvite, User
from app.db.models.mail_outbox import MailSourceKind
from app.modules.mail.outbox_service import cancel_source_mail


def cancel_invite_mail_for_scores(db: Session, score_ids: Sequence[int]) -> None:
    cancel_source_mail(
        db,
        MailSourceKind.SCORE_INVITE,
        select(ScoreInvite.id).where(ScoreInvite.score_id.in_(score_ids)),
    )


def cancel_closed_account_invite_mail(db: Session, user_id: int) -> None:
    # A foreign owner's contact record is not owned by the recipient email.
    cancel_source_mail(
        db,
        MailSourceKind.SCORE_INVITE,
        select(ScoreInvite.id).where(
            or_(
                ScoreInvite.score_id.in_(select(Score.id).where(Score.owner_user_id == user_id)),
                ScoreInvite.created_by_user_id == user_id,
            )
        ),
    )


def invitation_mail_source_active(db: Session, invite_id: int) -> bool:
    from app.modules.score_access.queries import active_score_predicate
    from app.shared.time import utc_now

    return (
        db.scalar(
            select(ScoreInvite.id)
            .join(Score, Score.id == ScoreInvite.score_id)
            .where(
                ScoreInvite.id == invite_id,
                ScoreInvite.__table__.c.terminal_outcome.is_(None),
                or_(
                    ScoreInvite.__table__.c.expires_at.is_(None), ScoreInvite.expires_at > utc_now()
                ),
                active_score_predicate(),
                exists(
                    select(User.id).where(
                        User.id == ScoreInvite.created_by_user_id,
                        User.is_active.is_(True),
                        User.deleted_at.is_(None),
                    )
                ).correlate(ScoreInvite),
            )
        )
        is not None
    )
