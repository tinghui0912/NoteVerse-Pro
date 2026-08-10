from sqlmodel import SQLModel, Session, create_engine, select

from app.db.execution_manifests import get_or_create_execution_manifest, manifest_sha256
from app.db.models import ExecutionManifest
from app.modules.playback.execution_manifest import build_playback_execution_manifest
from app.modules.playback.playback_profile import DEFAULT_PLAYBACK_PROFILE, PlaybackProfile


def test_playback_profile_has_stable_audio_semantics() -> None:
    assert DEFAULT_PLAYBACK_PROFILE.identity() == {
        "schema_version": 1,
        "midi_engine": "verovio",
        "audio_engine": "fluidsynth",
        "sample_rate": 44100,
        "max_duration_seconds": 180.0,
    }


def test_playback_profile_rejects_invalid_output_limits() -> None:
    try:
        PlaybackProfile(sample_rate=0)
    except ValueError as exc:
        assert str(exc) == "sample_rate must be positive"
    else:
        raise AssertionError("PlaybackProfile must reject a non-positive sample rate")


def test_playback_execution_manifest_is_stable_and_content_addressed() -> None:
    manifest = build_playback_execution_manifest()
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        first = get_or_create_execution_manifest(session, manifest)
        second = get_or_create_execution_manifest(session, manifest)
        session.commit()

        assert manifest_sha256(manifest) == manifest_sha256(dict(reversed(list(manifest.items()))))
        assert first.id == second.id
        assert len(list(session.exec(select(ExecutionManifest)))) == 1
