from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    ScoreMembership,
    ScoreShareGrant,
    ShareGrantRedemption,
)

grant_created_col = ScoreShareGrant.__table__.c.created_at


class ScoreSharingRepository:
    async def grant_by_token_hash(
        self, db: AsyncSession, token_hash: str
    ) -> ScoreShareGrant | None:
        return (
            await db.execute(
                select(ScoreShareGrant).where(
                    ScoreShareGrant.token_hash == token_hash
                )
            )
        ).scalar_one_or_none()

    async def grant_by_uuid(
        self, db: AsyncSession, grant_uuid: str
    ) -> ScoreShareGrant | None:
        return (
            await db.execute(
                select(ScoreShareGrant).where(
                    ScoreShareGrant.grant_uuid == grant_uuid
                )
            )
        ).scalar_one_or_none()

    async def grants(self, db: AsyncSession, score_id: int) -> list[ScoreShareGrant]:
        return list(
            (
                await db.execute(
                    select(ScoreShareGrant)
                    .where(ScoreShareGrant.score_id == score_id)
                    .order_by(grant_created_col.desc())
                )
            ).scalars().all()
        )

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

    async def redemption(
        self, db: AsyncSession, grant_id: int, user_id: int
    ) -> ShareGrantRedemption | None:
        return (
            await db.execute(
                select(ShareGrantRedemption).where(
                    ShareGrantRedemption.grant_id == grant_id,
                    ShareGrantRedemption.user_id == user_id,
                )
            )
        ).scalar_one_or_none()

