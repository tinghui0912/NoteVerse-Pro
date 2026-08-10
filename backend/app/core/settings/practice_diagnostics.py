"""Practice runtime diagnostic settings."""

from __future__ import annotations

from pydantic import BaseModel, field_validator


class PracticeDiagnosticsSettings(BaseModel):
    PRACTICE_AUDIO_DIAGNOSTICS: bool = False
    PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL: int = 15
    PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL: int = 15

    @field_validator(
        "PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL",
        "PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL",
    )
    @classmethod
    def validate_positive_interval(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("task timing settings must be positive integers")
        return value
