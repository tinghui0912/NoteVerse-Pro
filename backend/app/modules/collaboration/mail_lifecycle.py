"""Collaboration invalidates invitation deliveries by invitation/Score identity."""

from collections.abc import Sequence
from datetime import datetime
from sqlalchemy import select, or_, exists, and_, update, case, literal
from sqlalchemy.orm import Session
from app.db.models import Score, ScoreInvite, ScoreMembership, User
from app.db.models.score_access import InviteTerminalOutcome as Outcome
from app.db.models.mail_outbox import MailSourceKind
from app.modules.mail.outbox_service import cancel_source_mail


def cancel_invite_mail_for_scores(db: Session, score_ids: Sequence[int]) -> None:
    cancel_source_mail(
        db,
        MailSourceKind.SCORE_INVITE,
        select(ScoreInvite.id).where(ScoreInvite.score_id.in_(score_ids)),
    )


def close_account_collaboration_data(
    db: Session, *, user_id: int, email: str, closed_at: datetime, limit: int | None = None
) -> bool:
    """Caller owns the closed User fence and transaction. Never acquire Score locks.

    Invite locks precede Mail locks, matching acceptance/decline. Recipient cutoff
    is immutable across retries; creator/actor cleanup also covers late admissions.
    Finalization supplies a bounded batch under its exclusive User fence.
    """
    c = ScoreInvite.__table__.c
    recipient = and_(c.email == email.strip().lower(), c.created_at <= closed_at)
    creator = c.created_by_user_id == user_id
    contact = or_(recipient, creator)
    owned_score = c.score_id.in_(select(Score.id).where(Score.owner_user_id == user_id))
    if limit is not None and limit <= 0:
        raise ValueError("Collaboration cleanup limit must be positive")
    batch_size = limit if limit is not None else 500
    changed = False
    after_id = 0
    while True:
        affected = or_(contact, c.terminal_actor_user_id == user_id)
        if limit is None:
            affected = or_(affected, owned_score)
        ids = list(
            db.scalars(
                select(ScoreInvite.id)
                .where(affected, c.id > after_id)
                .order_by(c.id)
                .limit(batch_size)
                .with_for_update()
            )
        )
        if not ids:
            break
        # Lock the semantic record before its mail, including owner-only cancellation.
        cancel_source_mail(
            db,
            MailSourceKind.SCORE_INVITE,
            select(ScoreInvite.id).where(c.id.in_(ids), or_(contact, owned_score)),
        )
        pending = c.terminal_outcome.is_(None)
        db.execute(
            update(ScoreInvite.__table__)
            .where(c.id.in_(ids))
            .values(
                terminal_outcome=case(
                    (
                        and_(pending, recipient),
                        literal(Outcome.RECIPIENT_ACCOUNT_CLOSED, type_=c.terminal_outcome.type),
                    ),
                    (
                        and_(pending, creator),
                        literal(Outcome.INVITER_ACCOUNT_CLOSED, type_=c.terminal_outcome.type),
                    ),
                    else_=c.terminal_outcome,
                ),
                terminal_at=case((and_(pending, contact), closed_at), else_=c.terminal_at),
                terminal_actor_user_id=case(
                    (or_(c.terminal_actor_user_id == user_id, and_(pending, contact)), None),
                    else_=c.terminal_actor_user_id,
                ),
                email=case((contact, None), else_=c.email),
                token_hash=case((contact, None), else_=c.token_hash),
                created_by_user_id=case((creator, None), else_=c.created_by_user_id),
            )
        )
        changed = True
        after_id = ids[-1]
        if limit is not None:
            break
    while True:
        member_ids = list(
            db.scalars(
                select(ScoreMembership.id)
                .where(ScoreMembership.created_by_user_id == user_id)
                .order_by(ScoreMembership.id)
                .limit(batch_size)
                .with_for_update()
            )
        )
        if not member_ids:
            break
        db.execute(
            update(ScoreMembership)
            .where(
                ScoreMembership.id.in_(member_ids), ScoreMembership.created_by_user_id == user_id
            )
            .values(created_by_user_id=None)
        )
        changed = True
        if limit is not None:
            break
    return changed


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
