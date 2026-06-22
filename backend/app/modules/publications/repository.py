from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ScorePublication


class PublicationRepository:
    async def by_score(
        self, db: AsyncSession, score_id: int
    ) -> ScorePublication | None:
        return (
            await db.execute(
                select(ScorePublication).where(ScorePublication.score_id == score_id)
            )
        ).scalar_one_or_none()

    async def by_slug(
        self, db: AsyncSession, slug: str
    ) -> ScorePublication | None:
        return (
            await db.execute(
                select(ScorePublication).where(ScorePublication.public_slug == slug)
            )
        ).scalar_one_or_none()
