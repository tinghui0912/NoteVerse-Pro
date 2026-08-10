"""Resolved provenance identity for generated playback assets."""

from app.modules.playback.playback_profile import DEFAULT_PLAYBACK_PROFILE


def build_playback_execution_manifest() -> dict[str, object]:
    """Return the immutable algorithm profile that controls generated audio."""

    profile = DEFAULT_PLAYBACK_PROFILE
    return {
        "schema_version": 1,
        "kind": "playback",
        "midi_engine": profile.midi_engine,
        "audio_engine": profile.audio_engine,
        "profile": profile.identity(),
    }
