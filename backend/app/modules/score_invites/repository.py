from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ScoreInvite, ScoreMembership, User


invite_created_col = ScoreInvite.__table__.c.created_at
membership_created_col = ScoreMembership.__table__.c.created_at


class ScoreInviteRepository:
    async def invite_by_token_hash(
        self, db: AsyncSession, token_hash: str
    ) -> ScoreInvite | None:
        return (
            await db.execute(select(ScoreInvite).where(ScoreInvite.token_hash == token_hash))
        ).scalar_one_or_none()

    async def invite_by_uuid(
        self, db: AsyncSession, invite_uuid: str
    ) -> ScoreInvite | None:
        return (
            await db.execute(select(ScoreInvite).where(ScoreInvite.invite_uuid == invite_uuid))
        ).scalar_one_or_none()

    async def invites(self, db: AsyncSession, score_id: int) -> list[ScoreInvite]:
        return list(
            (
                await db.execute(
                    select(ScoreInvite)
                    .where(ScoreInvite.score_id == score_id)
                    .order_by(invite_created_col.desc())
                )
            ).scalars().all()
        )

    async def membership_by_id(
        self, db: AsyncSession, membership_id: int
    ) -> ScoreMembership | None:
        return await db.get(ScoreMembership, membership_id)

    async def membership(
        self, db: AsyncSession, score_id: int, user_id: int
    ) -> ScoreMembership | None:
        return (
            await db.execute(
                select(ScoreMembership).where(
                    ScoreMembership.score_id == score_id,
                    ScoreMembership.user_id == user_id,
                )
            )
        ).scalar_one_or_none()

    async def memberships(self, db: AsyncSession, score_id: int) -> list[ScoreMembership]:
        return list(
            (
                await db.execute(
                    select(ScoreMembership)
                    .where(ScoreMembership.score_id == score_id)
                    .order_by(membership_created_col.asc())
                )
            ).scalars().all()
        )

    async def user_by_email(self, db: AsyncSession, email: str) -> User | None:
        return (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
