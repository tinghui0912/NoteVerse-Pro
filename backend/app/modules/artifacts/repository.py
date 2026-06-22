from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ScoreArtifact, ScoreRevision
from app.db.models.score import ArtifactKind


class ArtifactRepository:
    async def get(self, db: AsyncSession, artifact_uuid: str) -> ScoreArtifact | None:
        return (
            await db.execute(
                select(ScoreArtifact).where(ScoreArtifact.artifact_uuid == artifact_uuid)
            )
        ).scalar_one_or_none()

    async def list_for_revision(
        self,
        db: AsyncSession,
        revision_id: int,
        kind: ArtifactKind | None = None,
    ) -> list[ScoreArtifact]:
        statement = select(ScoreArtifact).where(ScoreArtifact.revision_id == revision_id)
        if kind is not None:
            statement = statement.where(ScoreArtifact.kind == kind)
        statement = statement.order_by(ScoreArtifact.kind, ScoreArtifact.page_number)
        return list((await db.execute(statement)).scalars().all())

    async def revision_for_artifact(
        self, db: AsyncSession, artifact: ScoreArtifact
    ) -> ScoreRevision | None:
        return await db.get(ScoreRevision, artifact.revision_id)
