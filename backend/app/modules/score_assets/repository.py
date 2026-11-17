from __future__ import annotations

from typing import TypeAlias

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.db.models import (
    PlaybackAssetKind,
    PlaybackOutbox,
    Score,
    ScorePlaybackAsset,
    ScoreRenderAsset,
    ScoreRevision,
    ScoreRevisionSource,
)
from app.db.models.score import RenderAssetKind, RevisionSourceFormat

ScoreAssetRecord: TypeAlias = ScoreRevisionSource | ScoreRenderAsset


class ScoreAssetRepository:
    def get_source(self, db: Session, source_uuid: str) -> ScoreRevisionSource | None:
        return (
            db.execute(
                select(ScoreRevisionSource).where(ScoreRevisionSource.source_uuid == source_uuid)
            )
        ).scalar_one_or_none()

    def get_render_asset(self, db: Session, asset_uuid: str) -> ScoreRenderAsset | None:
        return (
            db.execute(select(ScoreRenderAsset).where(ScoreRenderAsset.asset_uuid == asset_uuid))
        ).scalar_one_or_none()

    def list_sources(
        self,
        db: Session,
        revision_id: int,
        source_format: RevisionSourceFormat | None = None,
    ) -> list[ScoreRevisionSource]:
        statement = select(ScoreRevisionSource).where(
            ScoreRevisionSource.revision_id == revision_id
        )
        if source_format is not None:
            statement = statement.where(ScoreRevisionSource.format == source_format)
        return list((db.execute(statement)).scalars().all())

    def canonical_source(self, db: Session, revision_id: int) -> ScoreRevisionSource | None:
        return (
            db.execute(
                select(ScoreRevisionSource).where(
                    ScoreRevisionSource.revision_id == revision_id,
                    ScoreRevisionSource.format == RevisionSourceFormat.MUSICXML,
                )
            )
        ).scalar_one_or_none()

    def list_render_assets(
        self,
        db: Session,
        revision_id: int,
        kind: RenderAssetKind | None = None,
        *,
        render_profile: str | None = None,
    ) -> list[ScoreRenderAsset]:
        statement = (
            select(ScoreRenderAsset)
            .where(ScoreRenderAsset.revision_id == revision_id)
            .order_by(ScoreRenderAsset.kind, ScoreRenderAsset.page_number)
        )
        if render_profile is not None:
            statement = statement.where(ScoreRenderAsset.render_profile == render_profile)
        if kind is not None:
            statement = statement.where(ScoreRenderAsset.kind == kind)
        return list((db.execute(statement)).scalars().all())

    def first_rendered_page_asset(
        self, db: Session, revision_id: int, *, render_profile: str
    ) -> ScoreRenderAsset | None:
        return (
            db.execute(
                select(ScoreRenderAsset)
                .where(
                    ScoreRenderAsset.revision_id == revision_id,
                    ScoreRenderAsset.kind == RenderAssetKind.RENDERED_PAGE,
                    ScoreRenderAsset.render_profile == render_profile,
                )
                .order_by(
                    col(ScoreRenderAsset.page_number).asc(),
                    col(ScoreRenderAsset.created_at).asc(),
                    ScoreRenderAsset.id.asc(),
                )
                .limit(1)
            )
        ).scalar_one_or_none()

    def playback_asset(
        self,
        db: Session,
        revision_id: int,
        *,
        kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
    ) -> ScorePlaybackAsset | None:
        return (
            db.execute(
                select(ScorePlaybackAsset)
                .where(
                    ScorePlaybackAsset.revision_id == revision_id,
                    ScorePlaybackAsset.kind == kind,
                )
                .limit(1)
            )
        ).scalar_one_or_none()

    def latest_playback_outbox(
        self,
        db: Session,
        revision_id: int,
        *,
        kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
    ) -> PlaybackOutbox | None:
        return (
            db.execute(
                select(PlaybackOutbox)
                .where(
                    PlaybackOutbox.revision_id == revision_id,
                    PlaybackOutbox.asset_kind == kind,
                )
                .order_by(col(PlaybackOutbox.created_at).desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    def revision_identity_for_asset(
        self, db: Session, asset: ScoreAssetRecord
    ) -> tuple[str, str] | None:
        row = db.execute(
            select(Score.score_uuid, ScoreRevision.revision_uuid)
            .join(ScoreRevision, ScoreRevision.score_id == Score.id)
            .where(ScoreRevision.id == asset.revision_id)
        ).one_or_none()
        return (row[0], row[1]) if row is not None else None
