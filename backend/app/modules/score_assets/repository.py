from __future__ import annotations

from typing import TypeAlias

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ScoreRenderAsset, ScoreRevision, ScoreRevisionSource
from app.db.models.score import RenderAssetKind, RevisionSourceFormat

ScoreAssetRecord: TypeAlias = ScoreRevisionSource | ScoreRenderAsset


class ScoreAssetRepository:
    async def get_source(
        self, db: AsyncSession, source_uuid: str
    ) -> ScoreRevisionSource | None:
        return (
            await db.execute(
                select(ScoreRevisionSource).where(
                    ScoreRevisionSource.source_uuid == source_uuid
                )
            )
        ).scalar_one_or_none()

    async def get_render_asset(
        self, db: AsyncSession, asset_uuid: str
    ) -> ScoreRenderAsset | None:
        return (
            await db.execute(
                select(ScoreRenderAsset).where(ScoreRenderAsset.asset_uuid == asset_uuid)
            )
        ).scalar_one_or_none()

    async def list_sources(
        self,
        db: AsyncSession,
        revision_id: int,
        source_format: RevisionSourceFormat | None = None,
    ) -> list[ScoreRevisionSource]:
        statement = select(ScoreRevisionSource).where(
            ScoreRevisionSource.revision_id == revision_id
        )
        if source_format is not None:
            statement = statement.where(ScoreRevisionSource.format == source_format)
        return list((await db.execute(statement)).scalars().all())

    async def list_render_assets(
        self,
        db: AsyncSession,
        revision_id: int,
        kind: RenderAssetKind | None = None,
    ) -> list[ScoreRenderAsset]:
        statement = (
            select(ScoreRenderAsset)
            .where(ScoreRenderAsset.revision_id == revision_id)
            .order_by(ScoreRenderAsset.kind, ScoreRenderAsset.page_number)
        )
        if kind is not None:
            statement = statement.where(ScoreRenderAsset.kind == kind)
        return list((await db.execute(statement)).scalars().all())

    async def revision_for_asset(
        self, db: AsyncSession, asset: ScoreAssetRecord
    ) -> ScoreRevision | None:
        return await db.get(ScoreRevision, asset.revision_id)
