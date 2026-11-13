from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Score, ScoreInvite, ScoreMembership, User
from app.modules.score_access.queries import active_score_predicate
from app.db.models.score_access import InviteStatus
from app.db.model_utils import require_persisted_id
from .pagination import decode_cursor, encode_cursor


class ScoreInviteRepository:
    async def invite_by_token_hash(
        self, db: AsyncSession, token_hash: str, *, lock: bool = False
    ) -> ScoreInvite | None:
        query = select(ScoreInvite).where(ScoreInvite.token_hash == token_hash)
        if lock:
            query = query.with_for_update().execution_options(
                populate_existing=True, autoflush=False
            )
        return (await db.execute(query)).scalar_one_or_none()

    async def invite_by_uuid(
        self, db: AsyncSession, invite_uuid: str, *, lock: bool = False
    ) -> ScoreInvite | None:
        query = select(ScoreInvite).where(ScoreInvite.invite_uuid == invite_uuid)
        if lock:
            query = query.with_for_update().execution_options(
                populate_existing=True, autoflush=False
            )
        return (await db.execute(query)).scalar_one_or_none()

    async def invites(
        self,
        db: AsyncSession,
        score_id: int,
        *,
        limit: int,
        cursor: str | None = None,
    ) -> tuple[list[ScoreInvite], str | None]:
        position = decode_cursor(cursor, kind="invites", scope=str(score_id))
        columns = ScoreInvite.__table__.c
        query = select(ScoreInvite).where(columns.score_id == score_id)
        if position:
            created_at, row_id = position
            query = query.where(
                or_(
                    columns.created_at < created_at,
                    and_(columns.created_at == created_at, columns.id < row_id),
                )
            )
        rows = list(
            (
                await db.execute(
                    query.order_by(columns.created_at.desc(), columns.id.desc()).limit(limit + 1)
                )
            )
            .scalars()
            .all()
        )
        items = rows[:limit]
        next_cursor = None
        if len(rows) > limit:
            last = items[-1]
            next_cursor = encode_cursor(
                "invites",
                str(score_id),
                last.created_at,
                require_persisted_id(last.id, entity="invite"),
            )
        return items, next_cursor

    async def pending_invites_for_email(
        self,
        db: AsyncSession,
        email: str,
        *,
        user_id: int,
        now: datetime,
        limit: int,
        cursor: str | None = None,
    ) -> tuple[list[ScoreInvite], str | None]:
        position = decode_cursor(cursor, kind="pending_invites", scope=str(user_id))
        columns = ScoreInvite.__table__.c
        query = select(ScoreInvite).where(
            columns.email == email,
            columns.status == InviteStatus.PENDING,
            or_(columns.expires_at.is_(None), columns.expires_at > now),
        )
        if position:
            created_at, row_id = position
            query = query.where(
                or_(
                    columns.created_at < created_at,
                    and_(columns.created_at == created_at, columns.id < row_id),
                )
            )
        rows = list(
            (
                await db.execute(
                    query.order_by(columns.created_at.desc(), columns.id.desc()).limit(limit + 1)
                )
            )
            .scalars()
            .all()
        )
        items = rows[:limit]
        next_cursor = None
        if len(rows) > limit:
            last = items[-1]
            next_cursor = encode_cursor(
                "pending_invites",
                str(user_id),
                last.created_at,
                require_persisted_id(last.id, entity="invite"),
            )
        return items, next_cursor

    async def membership_by_id_for_update(
        self, db: AsyncSession, membership_id: int
    ) -> ScoreMembership | None:
        return (
            await db.execute(
                select(ScoreMembership)
                .where(ScoreMembership.id == membership_id)
                .with_for_update()
                .execution_options(populate_existing=True, autoflush=False)
            )
        ).scalar_one_or_none()

    async def membership_for_update(
        self, db: AsyncSession, score_id: int, user_id: int
    ) -> ScoreMembership | None:
        return (
            await db.execute(
                select(ScoreMembership)
                .where(
                    ScoreMembership.score_id == score_id,
                    ScoreMembership.user_id == user_id,
                )
                .with_for_update()
                .execution_options(populate_existing=True, autoflush=False)
            )
        ).scalar_one_or_none()

    async def self_membership_for_update(
        self, db: AsyncSession, score_uuid: str, user_id: int
    ) -> ScoreMembership | None:
        return (
            await db.execute(
                select(ScoreMembership)
                .join(Score, Score.id == ScoreMembership.score_id)
                .where(
                    Score.score_uuid == score_uuid,
                    active_score_predicate(),
                    Score.owner_user_id != user_id,
                    ScoreMembership.user_id == user_id,
                )
                .with_for_update(of=ScoreMembership)
                .execution_options(populate_existing=True, autoflush=False)
            )
        ).scalar_one_or_none()

    async def memberships(
        self,
        db: AsyncSession,
        score_id: int,
        *,
        limit: int,
        cursor: str | None = None,
    ) -> tuple[list[ScoreMembership], str | None]:
        position = decode_cursor(cursor, kind="members", scope=str(score_id))
        columns = ScoreMembership.__table__.c
        query = select(ScoreMembership).where(columns.score_id == score_id)
        if position:
            created_at, row_id = position
            query = query.where(
                or_(
                    columns.created_at > created_at,
                    and_(columns.created_at == created_at, columns.id > row_id),
                )
            )
        rows = list(
            (
                await db.execute(
                    query.order_by(columns.created_at.asc(), columns.id.asc()).limit(limit + 1)
                )
            )
            .scalars()
            .all()
        )
        items = rows[:limit]
        next_cursor = None
        if len(rows) > limit:
            last = items[-1]
            next_cursor = encode_cursor(
                "members",
                str(score_id),
                last.created_at,
                require_persisted_id(last.id, entity="membership"),
            )
        return items, next_cursor

    async def user_by_email(self, db: AsyncSession, email: str) -> User | None:
        return (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
