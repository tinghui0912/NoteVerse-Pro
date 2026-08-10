"""Playback synthesis settings shared by API delivery and Worker generation."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, field_validator


class PlaybackSettings(BaseModel):
    PLAYBACK_SOUNDFONT_PATH: str

    @field_validator("PLAYBACK_SOUNDFONT_PATH")
    @classmethod
    def normalize_soundfont_path(cls, value: str) -> str:
        return str(Path(value).expanduser())
