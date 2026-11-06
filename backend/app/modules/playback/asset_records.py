from __future__ import annotations
from app.modules.storage_objects.facts import StoredObjectFacts
from app.modules.storage_objects.persistence import object_to_row

import hashlib
from dataclasses import dataclass

from app.db.models import PlaybackAssetKind, ScorePlaybackAsset
from app.processing.engines.playback import RenderedAudio
from app.storage import ObjectWriteResult


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
        storage_key=asset.stored_object.object_key,
        size_bytes=asset.stored_object.byte_size,
    )


def build_playback_asset_record(
    *,
    asset_uuid: str,
    revision_id: int,
    asset_kind: PlaybackAssetKind,
    stored: ObjectWriteResult,
    audio: RenderedAudio,
    execution_manifest_id: int,
    source_fingerprint: str,
) -> ScorePlaybackAsset:
    return ScorePlaybackAsset(
        asset_uuid=asset_uuid,
        revision_id=revision_id,
        kind=asset_kind,
        stored_object=object_to_row(
            StoredObjectFacts(
                object_key=stored.object_key,
                content_type=audio.mime_type,
                byte_size=len(audio.content),
                sha256=hashlib.sha256(audio.content).hexdigest(),
            )
        ),
        filename=stored.object_key.rsplit("/", 1)[-1],
        execution_manifest_id=execution_manifest_id,
        duration_ms=audio.duration_ms,
        source_fingerprint=source_fingerprint,
        generator=audio.generator,
        generator_version=audio.generator_version,
    )
