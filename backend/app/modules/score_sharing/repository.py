from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    Score,
    ScoreBookmark,
    ScoreMembership,
    ScoreRevision,
    ScoreShareGrant,
    ShareGrantRedemption,
)

grant_created_col = ScoreShareGrant.__table__.c.created_at
bookmark_created_col = ScoreBookmark.__table__.c.created_at


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

    async def bookmark(
        self, db: AsyncSession, score_id: int, user_id: int
    ) -> ScoreBookmark | None:
        return (
            await db.execute(
                select(ScoreBookmark).where(
                    ScoreBookmark.score_id == score_id,
                    ScoreBookmark.user_id == user_id,
                )
            )
        ).scalar_one_or_none()

    async def bookmarks(
        self, db: AsyncSession, user_id: int
    ) -> list[tuple[ScoreBookmark, Score]]:
        rows = await db.execute(
            select(ScoreBookmark, Score)
            .join(Score, Score.id == ScoreBookmark.score_id)
            .where(ScoreBookmark.user_id == user_id)
            .order_by(bookmark_created_col.desc())
        )
        return list(rows.all())

    async def revision_uuid(
        self, db: AsyncSession, revision_id: int | None
    ) -> str | None:
        if revision_id is None:
            return None
        revision = await db.get(ScoreRevision, revision_id)
        return revision.revision_uuid if revision else None
