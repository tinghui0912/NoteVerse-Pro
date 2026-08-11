from __future__ import annotations

import hashlib
from dataclasses import dataclass

from app.db.models import PlaybackAssetKind, ScorePlaybackAsset
from app.processing.engines.playback import RenderedAudio
from app.storage import StoredFile


@dataclass(frozen=True)
class PlaybackAssetUsage:
    asset_uuid: str
    storage_key: str
    size_bytes: int


def playback_storage_key(
    *,
    score_uuid: str,
    revision_uuid: str,
    asset_uuid: str,
    extension: str,
) -> str:
    return f"scores/{score_uuid}/revisions/{revision_uuid}/playback/{asset_uuid}{extension}"


def playback_asset_usage(asset: ScorePlaybackAsset | None) -> PlaybackAssetUsage | None:
    if asset is None:
        return None
    return PlaybackAssetUsage(
        asset_uuid=asset.asset_uuid,
        storage_key=asset.storage_key,
        size_bytes=asset.size_bytes,
    )


def build_playback_asset_record(
    *,
    asset_uuid: str,
    revision_id: int,
    asset_kind: PlaybackAssetKind,
    storage_backend: str,
    stored: StoredFile,
    audio: RenderedAudio,
    execution_manifest_id: int,
    source_fingerprint: str,
) -> ScorePlaybackAsset:
    return ScorePlaybackAsset(
        asset_uuid=asset_uuid,
        revision_id=revision_id,
        kind=asset_kind,
        storage_backend=storage_backend,
        storage_key=stored.storage_key,
        filename=stored.filename,
        mime_type=audio.mime_type,
        size_bytes=stored.size_bytes,
        sha256=hashlib.sha256(audio.content).hexdigest(),
        execution_manifest_id=execution_manifest_id,
        duration_ms=audio.duration_ms,
        source_fingerprint=source_fingerprint,
        generator=audio.generator,
        generator_version=audio.generator_version,
    )
