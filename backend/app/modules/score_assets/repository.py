from __future__ import annotations

from typing import TypeAlias

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    PlaybackAssetKind,
    PlaybackOutbox,
    RenderOutbox,
    ScorePlaybackAsset,
    ScoreRenderAsset,
    ScoreRevision,
    ScoreRevisionSource,
)
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

    async def canonical_source(
        self, db: AsyncSession, revision_id: int
    ) -> ScoreRevisionSource | None:
        return (
            await db.execute(
                select(ScoreRevisionSource).where(
                    ScoreRevisionSource.revision_id == revision_id,
                    ScoreRevisionSource.format == RevisionSourceFormat.MUSICXML,
                )
            )
        ).scalar_one_or_none()

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

    async def first_rendered_page_asset(
        self, db: AsyncSession, revision_id: int
    ) -> ScoreRenderAsset | None:
        return (
            await db.execute(
                select(ScoreRenderAsset)
                .where(
                    ScoreRenderAsset.revision_id == revision_id,
                    ScoreRenderAsset.kind == RenderAssetKind.RENDERED_PAGE,
                )
                .order_by(ScoreRenderAsset.page_number.asc(), ScoreRenderAsset.created_at.asc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def latest_render_outbox(
        self, db: AsyncSession, revision_id: int, *, render_profile: str = "default"
    ) -> RenderOutbox | None:
        return (
            await db.execute(
                select(RenderOutbox)
                .where(
                    RenderOutbox.revision_id == revision_id,
                    RenderOutbox.render_profile == render_profile,
                )
                .order_by(RenderOutbox.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def playback_asset(
        self,
        db: AsyncSession,
        revision_id: int,
        *,
        kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
    ) -> ScorePlaybackAsset | None:
        return (
            await db.execute(
                select(ScorePlaybackAsset)
                .where(
                    ScorePlaybackAsset.revision_id == revision_id,
                    ScorePlaybackAsset.kind == kind,
                )
                .limit(1)
            )
        ).scalar_one_or_none()

    async def latest_playback_outbox(
        self,
        db: AsyncSession,
        revision_id: int,
        *,
        kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
    ) -> PlaybackOutbox | None:
        return (
            await db.execute(
                select(PlaybackOutbox)
                .where(
                    PlaybackOutbox.revision_id == revision_id,
                    PlaybackOutbox.asset_kind == kind,
                )
                .order_by(PlaybackOutbox.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def fallback_rendered_page_asset(
        self, db: AsyncSession, score_id: int, head_revision_id: int
    ) -> tuple[ScoreRenderAsset, ScoreRevision] | None:
        row = (
            await db.execute(
                select(ScoreRenderAsset, ScoreRevision)
                .join(ScoreRevision, ScoreRenderAsset.revision_id == ScoreRevision.id)
                .where(
                    ScoreRevision.score_id == score_id,
                    ScoreRevision.id != head_revision_id,
                    ScoreRenderAsset.kind == RenderAssetKind.RENDERED_PAGE,
                )
                .order_by(
                    ScoreRevision.revision_number.desc(),
                    ScoreRenderAsset.page_number.asc(),
                    ScoreRenderAsset.created_at.asc(),
                )
                .limit(1)
            )
        ).first()
        return (row[0], row[1]) if row else None

    async def fallback_playback_asset(
        self,
        db: AsyncSession,
        score_id: int,
        head_revision_id: int,
        *,
        kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
    ) -> tuple[ScorePlaybackAsset, ScoreRevision] | None:
        row = (
            await db.execute(
                select(ScorePlaybackAsset, ScoreRevision)
                .join(ScoreRevision, ScorePlaybackAsset.revision_id == ScoreRevision.id)
                .where(
                    ScoreRevision.score_id == score_id,
                    ScoreRevision.id != head_revision_id,
                    ScorePlaybackAsset.kind == kind,
                )
                .order_by(
                    ScoreRevision.revision_number.desc(),
                    ScorePlaybackAsset.created_at.asc(),
                )
                .limit(1)
            )
        ).first()
        return (row[0], row[1]) if row else None

    async def revision_for_asset(
        self, db: AsyncSession, asset: ScoreAssetRecord
    ) -> ScoreRevision | None:
        return await db.get(ScoreRevision, asset.revision_id)
