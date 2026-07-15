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


async def score_derived_assets(
    db,
    repository: ScoreAssetRepository,
    *,
    score_id: int,
    revision: ScoreRevision,
) -> ScoreDerivedAssetsRead:
    revision_id = require_persisted_id(revision.id, entity="score revision")
    thumbnail = await repository.first_rendered_page_asset(db, revision_id)
    fallback_thumbnail = None
    fallback_thumbnail_revision = None
    if thumbnail is None:
        fallback = await repository.fallback_rendered_page_asset(
            db, score_id, revision_id
        )
        if fallback:
            fallback_thumbnail, fallback_thumbnail_revision = fallback
    render_outbox = await repository.latest_render_outbox(db, revision_id)
    preview_status = derived_asset_status(
        has_current_asset=thumbnail is not None,
        outbox_status=render_outbox.status if render_outbox else None,
    )

    audio_asset = await repository.playback_asset(db, revision_id)
    fallback_audio = None
    fallback_audio_revision = None
    if audio_asset is None:
        fallback = await repository.fallback_playback_asset(db, score_id, revision_id)
        if fallback:
            fallback_audio, fallback_audio_revision = fallback
    playback_outbox = await repository.latest_playback_outbox(db, revision_id)
    audio_status = derived_asset_status(
        has_current_asset=audio_asset is not None,
        outbox_status=playback_outbox.status if playback_outbox else None,
    )

    displayed_thumbnail = thumbnail or fallback_thumbnail
    displayed_thumbnail_revision = revision if thumbnail else fallback_thumbnail_revision
    displayed_audio = audio_asset or fallback_audio
    displayed_audio_revision = revision if audio_asset else fallback_audio_revision

    return ScoreDerivedAssetsRead(
        preview=ScoreDerivedAssetRead(
            status=preview_status,
            asset_id=displayed_thumbnail.asset_uuid if displayed_thumbnail else None,
            revision_id=(
                displayed_thumbnail_revision.revision_uuid
                if displayed_thumbnail_revision
                else None
            ),
            is_fallback=thumbnail is None and fallback_thumbnail is not None,
        ),
        audio=ScoreDerivedAssetRead(
            status=audio_status,
            asset_id=displayed_audio.asset_uuid if displayed_audio else None,
            revision_id=(
                displayed_audio_revision.revision_uuid
                if displayed_audio_revision
                else None
            ),
            is_fallback=audio_asset is None and fallback_audio is not None,
        ),
    )
