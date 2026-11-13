"""SQL eligibility from Score ownership and current collaboration membership."""

from sqlalchemy import and_, or_, select, exists
from sqlalchemy.sql.elements import ColumnElement
from app.db.models import Score, ScoreMembership


def active_score_predicate() -> ColumnElement[bool]:
    return Score.__table__.c.deleted_at.is_(None)


def active_membership_predicate(user_id: int) -> ColumnElement[bool]:
    return and_(
        ScoreMembership.__table__.c.user_id == user_id,
        ScoreMembership.__table__.c.revoked_at.is_(None),
    )


def accessible_score_predicate(user_id: int) -> ColumnElement[bool]:
    membership = exists(
        select(1)
        .select_from(ScoreMembership)
        .where(
            ScoreMembership.__table__.c.score_id == Score.__table__.c.id,
            active_membership_predicate(user_id),
        )
        .correlate(Score)
    )
    return and_(
        active_score_predicate(), or_(Score.__table__.c.owner_user_id == user_id, membership)
    )
