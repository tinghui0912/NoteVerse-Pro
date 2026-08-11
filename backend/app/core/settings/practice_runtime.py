"""Strict Practice runtime settings projection."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.settings.practice_diagnostics import PracticeDiagnosticsSettings


class PracticeRuntimeSettings(PracticeDiagnosticsSettings, BaseSettings):
    """Strict Practice-only audio alignment environment contract."""

    PRACTICE_SOUNDFONT_PATH: str

    @field_validator("PRACTICE_SOUNDFONT_PATH")
    @classmethod
    def normalize_soundfont_path(cls, value: str) -> str:
        return str(Path(value).expanduser())

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")


@lru_cache
def get_practice_runtime_settings() -> PracticeRuntimeSettings:
    """Load Practice alignment configuration only in Practice-owned paths."""

    return PracticeRuntimeSettings()
