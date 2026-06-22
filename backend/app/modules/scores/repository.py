from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ProcessingJob, Score, ScoreArtifact, ScoreRevision
from app.db.models.score import ArtifactKind

score_title_col = Score.__table__.c.title
score_updated_col = Score.__table__.c.updated_at
revision_number_col = ScoreRevision.__table__.c.revision_number


class ScoreRepository:
    async def list_owned(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        page: int,
        page_size: int,
        search: str | None = None,
    ) -> tuple[list[Score], int]:
        filters = [Score.owner_user_id == user_id]
        if search:
            filters.append(score_title_col.ilike(f"%{search}%"))
        total = int(
            (
                await db.execute(select(func.count(Score.id)).where(*filters))
            ).scalar_one()
        )
        rows = await db.execute(
            select(Score)
            .where(*filters)
            .order_by(score_updated_col.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(rows.scalars().all()), total
    async def get(self, db: AsyncSession, score_uuid: str, *, lock: bool = False) -> Score | None:
        statement = select(Score).where(Score.score_uuid == score_uuid)
        if lock:
            statement = statement.with_for_update()
        return (await db.execute(statement)).scalar_one_or_none()

    async def revision(self, db: AsyncSession, revision_uuid: str) -> ScoreRevision | None:
        return (
            await db.execute(
                select(ScoreRevision).where(ScoreRevision.revision_uuid == revision_uuid)
            )
        ).scalar_one_or_none()

    async def revisions(self, db: AsyncSession, score_id: int) -> list[ScoreRevision]:
        rows = await db.execute(
            select(ScoreRevision)
            .where(ScoreRevision.score_id == score_id)
            .order_by(revision_number_col.desc())
        )
        return list(rows.scalars().all())

    async def canonical_artifact(
        self, db: AsyncSession, revision_id: int
    ) -> ScoreArtifact | None:
        return (
            await db.execute(
                select(ScoreArtifact).where(
                    ScoreArtifact.revision_id == revision_id,
                    ScoreArtifact.kind == ArtifactKind.MUSICXML,
                )
            )
        ).scalar_one_or_none()

    async def originating_job(
        self, db: AsyncSession, job_id: int | None
    ) -> ProcessingJob | None:
        if job_id is None:
            return None
        return await db.get(ProcessingJob, job_id)
