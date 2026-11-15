from __future__ import annotations

from app.db.models import PlaybackOutboxStatus, RenderOutboxStatus
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreRevision
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_assets.schemas import (
    DerivedAssetStatus,
    ScoreDerivedAssetRead,
    ScoreDerivedAssetsRead,
)


def derived_asset_status(
    *,
    has_current_asset: bool,
    outbox_status: RenderOutboxStatus | PlaybackOutboxStatus | None,
) -> DerivedAssetStatus:
    if has_current_asset:
        return "ready"
    if outbox_status in {
        RenderOutboxStatus.PENDING,
        RenderOutboxStatus.DISPATCHED,
        RenderOutboxStatus.PROCESSING,
        PlaybackOutboxStatus.PENDING,
        PlaybackOutboxStatus.DISPATCHED,
        PlaybackOutboxStatus.PROCESSING,
    }:
        return "processing"
    if outbox_status in {RenderOutboxStatus.FAILED, PlaybackOutboxStatus.FAILED}:
        return "unavailable"
    return "pending"


def score_derived_assets(
    db,
    repository: ScoreAssetRepository,
    *,
    revision: ScoreRevision,
) -> ScoreDerivedAssetsRead:
    revision_id = require_persisted_id(revision.id, entity="score revision")
    thumbnail = repository.first_rendered_page_asset(db, revision_id)
    render_outbox = repository.latest_render_outbox(db, revision_id)
    preview_status = derived_asset_status(
        has_current_asset=thumbnail is not None,
        outbox_status=render_outbox.status if render_outbox else None,
    )

    audio_asset = repository.playback_asset(db, revision_id)
    playback_outbox = repository.latest_playback_outbox(db, revision_id)
    audio_status = derived_asset_status(
        has_current_asset=audio_asset is not None,
        outbox_status=playback_outbox.status if playback_outbox else None,
    )

    return ScoreDerivedAssetsRead(
        preview=ScoreDerivedAssetRead(
            status=preview_status, asset_id=thumbnail.asset_uuid if thumbnail else None
        ),
        audio=ScoreDerivedAssetRead(
            status=audio_status, asset_id=audio_asset.asset_uuid if audio_asset else None
        ),
    )
