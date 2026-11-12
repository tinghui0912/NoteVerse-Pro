from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.db.models import (
    ImportJob,
    Score,
    ScoreDeletionStatus,
    ScoreRevision,
    LibraryEntrySourceType,
    ScoreLibraryEntry,
)
from app.modules.my_scores.schemas import MyScoresSort

score_title_col = Score.__table__.c.title
score_updated_col = Score.__table__.c.updated_at
active_score_filter = col(Score.deletion_status) == ScoreDeletionStatus.ACTIVE


class ScoreRepository:
    async def list_owned(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        page: int,
        page_size: int,
        search: str | None = None,
        sort: MyScoresSort = MyScoresSort.UPDATED_DESC,
    ) -> tuple[list[Score], int]:
        filters = [Score.owner_user_id == user_id, active_score_filter]
        if search:
            filters.append(score_title_col.ilike(f"%{search}%"))
        total = int((await db.execute(select(func.count(Score.id)).where(*filters))).scalar_one())
        order_by = {
            MyScoresSort.UPDATED_DESC: [score_updated_col.desc()],
            MyScoresSort.UPDATED_ASC: [score_updated_col.asc()],
            MyScoresSort.NAME_ASC: [score_title_col.asc()],
            MyScoresSort.NAME_DESC: [score_title_col.desc()],
        }[sort]
        rows = await db.execute(
            select(Score)
            .where(*filters)
            .order_by(*order_by)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(rows.scalars().all()), total

    async def active_library_score_ids(
        self,
        db: AsyncSession,
        user_id: int,
        score_ids: list[int],
    ) -> set[int]:
        if not score_ids:
            return set()
        rows = await db.execute(
            select(ScoreLibraryEntry.score_id).where(
                ScoreLibraryEntry.user_id == user_id,
                col(ScoreLibraryEntry.score_id).in_(score_ids),
                ScoreLibraryEntry.source_type == LibraryEntrySourceType.SELF_ADDED,
                col(ScoreLibraryEntry.deleted_at).is_(None),
            )
        )
        return {int(score_id) for score_id in rows.scalars().all()}

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
            statement = statement.with_for_update()
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
