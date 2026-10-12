"""Practice score-asset settings projection.

This module is for source/artifact delivery assets such as the practice
SoundFont used while preparing score content. It is not a live backend Practice
session runtime and must not be used to reintroduce backend-authoritative
Practice execution.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class PracticeRuntimeSettings(BaseSettings):
    """Strict Practice score-asset environment contract."""

    PRACTICE_SOUNDFONT_PATH: str

    @field_validator("PRACTICE_SOUNDFONT_PATH")
    @classmethod
    def normalize_soundfont_path(cls, value: str) -> str:
        return str(Path(value).expanduser())

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")


@lru_cache
def get_practice_runtime_settings() -> PracticeRuntimeSettings:
    """Load Practice score-asset configuration for source/artifact tooling."""

    return PracticeRuntimeSettings()
