from __future__ import annotations

from typing import TypeAlias

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ScoreRenderAsset, ScoreRevision, ScoreRevisionSource
from app.db.models.score import ArtifactKind

ArtifactRecord: TypeAlias = ScoreRevisionSource | ScoreRenderAsset


class ArtifactRepository:
    async def get(self, db: AsyncSession, artifact_uuid: str) -> ArtifactRecord | None:
        source = (
            await db.execute(
                select(ScoreRevisionSource).where(
                    ScoreRevisionSource.source_uuid == artifact_uuid
                )
            )
        ).scalar_one_or_none()
        if source is not None:
            return source
        return (
            await db.execute(
                select(ScoreRenderAsset).where(ScoreRenderAsset.asset_uuid == artifact_uuid)
            )
        ).scalar_one_or_none()

    async def list_for_revision(
        self,
        db: AsyncSession,
        revision_id: int,
        kind: ArtifactKind | None = None,
    ) -> list[ArtifactRecord]:
        items: list[ArtifactRecord] = []
        if kind in {None, ArtifactKind.MUSICXML}:
            sources = (
                await db.execute(
                    select(ScoreRevisionSource).where(
                        ScoreRevisionSource.revision_id == revision_id
                    )
                )
            ).scalars().all()
            items.extend(sources)
        if kind in {None, ArtifactKind.RENDERED_PAGE}:
            renders = (
                await db.execute(
                    select(ScoreRenderAsset)
                    .where(ScoreRenderAsset.revision_id == revision_id)
                    .order_by(ScoreRenderAsset.kind, ScoreRenderAsset.page_number)
                )
            ).scalars().all()
            items.extend(renders)
        return items

    async def revision_for_artifact(
        self, db: AsyncSession, artifact: ArtifactRecord
    ) -> ScoreRevision | None:
        return await db.get(ScoreRevision, artifact.revision_id)
