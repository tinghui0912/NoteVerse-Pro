from __future__ import annotations

from app.db.models import PlaybackOutboxStatus, RenderOutboxStatus
from app.modules.scores.schemas import DerivedAssetStatus


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
        return "failed"
    return "pending"
