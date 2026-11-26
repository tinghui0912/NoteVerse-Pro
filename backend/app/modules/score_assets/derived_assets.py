from __future__ import annotations

from app.modules.playback.domain import PlaybackOutboxStatus
from app.modules.revisions.render_states import ScoreRevisionRenderStatus
from app.score_semantics.render_profile import SCORE_PRESENTATION_RENDER_PROFILE
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreRevision
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.revisions.render_queries import revision_render_status
from app.modules.score_assets.schemas import (
    DerivedAssetStatus,
    ScoreDerivedAssetRead,
    ScoreDerivedAssetsRead,
)


def derived_asset_status(
    *,
    has_current_asset: bool,
    outbox_status: ScoreRevisionRenderStatus | PlaybackOutboxStatus | None,
) -> DerivedAssetStatus:
    if has_current_asset:
        return "ready"
    if outbox_status in {
        ScoreRevisionRenderStatus.PENDING,
        ScoreRevisionRenderStatus.DISPATCHED,
        ScoreRevisionRenderStatus.PROCESSING,
        PlaybackOutboxStatus.PENDING,
        PlaybackOutboxStatus.DISPATCHED,
        PlaybackOutboxStatus.PROCESSING,
    }:
        return "processing"
    if outbox_status in {ScoreRevisionRenderStatus.FAILED, PlaybackOutboxStatus.FAILED}:
        return "unavailable"
    return "pending"


def score_derived_assets(
    db,
    repository: ScoreAssetRepository,
    *,
    revision: ScoreRevision,
) -> ScoreDerivedAssetsRead:
    revision_id = require_persisted_id(revision.id, entity="score revision")
    thumbnail = repository.first_rendered_page_asset(
        db, revision_id, render_profile=SCORE_PRESENTATION_RENDER_PROFILE
    )
    render_status = revision_render_status(
        db, revision_id, render_profile=SCORE_PRESENTATION_RENDER_PROFILE
    )
    preview_status = derived_asset_status(
        has_current_asset=thumbnail is not None,
        outbox_status=render_status,
    )

    audio_asset = repository.playback_asset(db, revision_id)
    playback_outbox = repository.latest_playback_outbox(db, revision_id)
    audio_status = derived_asset_status(
        has_current_asset=audio_asset is not None,
        outbox_status=playback_outbox.status if playback_outbox else None,
    )

    return derived_assets_read(
        thumbnail.asset_uuid if thumbnail else None,
        preview_status,
        audio_asset.asset_uuid if audio_asset else None,
        audio_status,
    )


def derived_assets_read(
    thumbnail_id: str | None,
    preview_status: DerivedAssetStatus,
    audio_id: str | None,
    audio_status: DerivedAssetStatus,
) -> ScoreDerivedAssetsRead:
    return ScoreDerivedAssetsRead(
        preview=ScoreDerivedAssetRead(status=preview_status, asset_id=thumbnail_id),
        audio=ScoreDerivedAssetRead(status=audio_status, asset_id=audio_id),
    )
