from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ScoreGuestPreviewGrant


class GuestPreviewRepository:
    async def by_token_hash(
        self, db: AsyncSession, token_hash: str
    ) -> ScoreGuestPreviewGrant | None:
        return (
            await db.execute(
                select(ScoreGuestPreviewGrant).where(
                    ScoreGuestPreviewGrant.token_hash == token_hash
                )
            )
        ).scalar_one_or_none()

    async def by_uuid(self, db: AsyncSession, preview_uuid: str) -> ScoreGuestPreviewGrant | None:
        return (
            await db.execute(
                select(ScoreGuestPreviewGrant).where(
                    ScoreGuestPreviewGrant.preview_uuid == preview_uuid
                )
            )
        ).scalar_one_or_none()

    async def list_for_score(
        self, db: AsyncSession, score_id: int, limit: int
    ) -> list[ScoreGuestPreviewGrant]:
        return list(
            (
                await db.execute(
                    select(ScoreGuestPreviewGrant)
                    .where(ScoreGuestPreviewGrant.score_id == score_id)
                    .order_by(ScoreGuestPreviewGrant.__table__.c.created_at.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
