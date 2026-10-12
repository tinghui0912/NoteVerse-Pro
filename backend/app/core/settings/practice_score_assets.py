"""Practice score-asset settings.

These settings support backend score/source/artifact delivery, such as the
optional SoundFont Partitura may need while preparing practice-ready score
content. They are not a live backend Practice runtime contract.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class PracticeScoreAssetSettings(BaseSettings):
    """Strict environment contract for Practice score-asset tooling."""

    PRACTICE_SOUNDFONT_PATH: str

    @field_validator("PRACTICE_SOUNDFONT_PATH")
    @classmethod
    def normalize_soundfont_path(cls, value: str) -> str:
        return str(Path(value).expanduser())

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")


@lru_cache
def get_practice_score_asset_settings() -> PracticeScoreAssetSettings:
    """Load Practice score-asset configuration for source/artifact tooling."""

    return PracticeScoreAssetSettings()
