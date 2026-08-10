"""Playback synthesis settings shared by API delivery and Worker generation."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, field_validator


class PlaybackSettings(BaseModel):
    PLAYBACK_SOUNDFONT_PATH: str
    PLAYBACK_SAMPLE_RATE: int = 44100
    PLAYBACK_MAX_DURATION_SECONDS: float = 180.0

    @field_validator("PLAYBACK_SOUNDFONT_PATH")
    @classmethod
    def normalize_soundfont_path(cls, value: str) -> str:
        return str(Path(value).expanduser())

    @field_validator("PLAYBACK_SAMPLE_RATE")
    @classmethod
    def validate_positive_sample_rate(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("task timing settings must be positive integers")
        return value

    @field_validator("PLAYBACK_MAX_DURATION_SECONDS")
    @classmethod
    def validate_max_duration(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("PLAYBACK_MAX_DURATION_SECONDS must be positive")
        return value
