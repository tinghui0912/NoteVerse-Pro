from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.db.models import (
    ImportJob,
    Score,
    ScoreRevision,
)

active_score_filter = col(Score.deleted_at).is_(None)


class ScoreRepository:
    async def get(
        self,
        db: AsyncSession,
        score_uuid: str,
        *,
        lock: bool = False,
        include_deleted: bool = False,
    ) -> Score | None:
        statement = select(Score).where(Score.score_uuid == score_uuid)
        if not include_deleted:
            statement = statement.where(active_score_filter)
        if lock:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return (await db.execute(statement)).scalar_one_or_none()

    async def revision(self, db: AsyncSession, revision_uuid: str) -> ScoreRevision | None:
        return (
            await db.execute(
                select(ScoreRevision).where(ScoreRevision.revision_uuid == revision_uuid)
            )
        ).scalar_one_or_none()

    async def revisions(
        self,
        db: AsyncSession,
        score_id: int,
        *,
        limit: int,
        cursor: int | None = None,
    ) -> tuple[list[ScoreRevision], int | None]:
        statement = select(ScoreRevision).where(ScoreRevision.score_id == score_id)
        if cursor is not None:
            statement = statement.where(ScoreRevision.revision_number < cursor)
        rows = list(
            (
                await db.execute(
                    statement.order_by(col(ScoreRevision.revision_number).desc()).limit(limit + 1)
                )
            )
            .scalars()
            .all()
        )
        items = rows[:limit]
        next_cursor = items[-1].revision_number if len(rows) > limit and items else None
        return items, next_cursor

    async def all_revisions(self, db: AsyncSession, score_id: int) -> list[ScoreRevision]:
        return list(
            (
                await db.execute(
                    select(ScoreRevision)
                    .where(ScoreRevision.score_id == score_id)
                    .order_by(col(ScoreRevision.revision_number).desc())
                )
            )
            .scalars()
            .all()
        )

    async def originating_job(self, db: AsyncSession, job_id: int | None) -> ImportJob | None:
        if job_id is None:
            return None
        return await db.get(ImportJob, job_id)
