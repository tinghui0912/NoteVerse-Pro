"""Resolved provenance identity for generated playback assets."""

from app.processing.engines.playback import DEFAULT_PLAYBACK_PROFILE


def build_playback_execution_manifest(*, soundfont_sha256: str) -> dict[str, object]:
    """Return the immutable algorithm profile that controls generated audio."""

    if len(soundfont_sha256) != 64:
        raise ValueError("soundfont_sha256 must be a SHA-256 digest")
    profile = DEFAULT_PLAYBACK_PROFILE
    return {
        "schema_version": 1,
        "kind": "playback",
        "midi_engine": profile.midi_engine,
        "audio_engine": profile.audio_engine,
        "profile": profile.identity(),
        "soundfont": {"sha256": soundfont_sha256},
    }
