from types import SimpleNamespace
from typing import cast

from app.db.models import PlaybackAssetKind, ScorePlaybackAsset
from app.modules.playback.asset_records import (
    build_playback_asset_record,
    playback_asset_usage,
    playback_storage_key,
)
from app.processing.engines.playback import RenderedAudio
from app.storage import ObjectWriteResult


def test_playback_storage_key_uses_revision_scoped_asset_path() -> None:
    assert (
        playback_storage_key(
            score_uuid="score-1",
            revision_uuid="revision-1",
            asset_uuid="asset-1",
            extension=".wav",
        )
        == "scores/score-1/revisions/revision-1/playback/asset-1.wav"
    )


def test_playback_asset_usage_captures_replacement_release_fields() -> None:
    usage = playback_asset_usage(
        cast(
            ScorePlaybackAsset,
            SimpleNamespace(
                asset_uuid="asset-old",
                stored_object=SimpleNamespace(object_key="scores/old.wav", byte_size=123),
            ),
        )
    )

    assert usage is not None
    assert usage.asset_uuid == "asset-old"
    assert usage.storage_key == "scores/old.wav"
    assert usage.size_bytes == 123
    assert playback_asset_usage(None) is None


def test_build_playback_asset_record_uses_rendered_audio_metadata() -> None:
    asset = build_playback_asset_record(
        asset_uuid="asset-1",
        revision_id=17,
        asset_kind=PlaybackAssetKind.AUDIO,
        stored=ObjectWriteResult(
            object_key="scores/score-1/revisions/revision-1/playback/asset-1.wav",
            size_bytes=10,
        ),
        audio=RenderedAudio(
            content=b"audio-data",
            mime_type="audio/wav",
            extension=".wav",
            duration_ms=3210,
            generator="test-generator",
            generator_version="1",
            soundfont_sha256="a" * 64,
        ),
        execution_manifest_id=19,
        source_fingerprint="b" * 64,
    )

    assert asset.asset_uuid == "asset-1"
    assert asset.revision_id == 17
    assert asset.kind == PlaybackAssetKind.AUDIO
    assert asset.stored_object.object_key.endswith("/asset-1.wav")
    assert asset.stored_object.content_type == "audio/wav"
    assert asset.stored_object.byte_size == 10
    assert asset.duration_ms == 3210
    assert asset.execution_manifest_id == 19
    assert asset.source_fingerprint == "b" * 64
    assert asset.generator == "test-generator"
    assert asset.generator_version == "1"
    assert len(asset.stored_object.sha256) == 64
