"""Versioned output profile for the playback processing engine."""

from dataclasses import asdict, dataclass
from typing import Final


@dataclass(frozen=True)
class PlaybackProfile:
    """Immutable semantics for the supported Verovio and FluidSynth pipeline."""

    schema_version: int = 1
    midi_engine: str = "verovio"
    audio_engine: str = "fluidsynth"
    sample_rate: int = 44100
    max_duration_seconds: float = 180.0

    def __post_init__(self) -> None:
        if self.sample_rate <= 0:
            raise ValueError("sample_rate must be positive")
        if self.max_duration_seconds <= 0:
            raise ValueError("max_duration_seconds must be positive")

    def identity(self) -> dict[str, object]:
        """Return the complete profile for execution provenance."""

        return asdict(self)


DEFAULT_PLAYBACK_PROFILE: Final[PlaybackProfile] = PlaybackProfile()
