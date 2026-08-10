"""Realtime event retention and cleanup settings."""

from pydantic import BaseModel, field_validator


class RealtimeRetentionSettings(BaseModel):
    """Shared policy for realtime-event retention and scheduled cleanup."""

    REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS: int
    REALTIME_EVENT_RETENTION_DAYS: int

    @field_validator(
        "REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS",
        "REALTIME_EVENT_RETENTION_DAYS",
    )
    @classmethod
    def validate_positive_realtime_retention_setting(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("realtime retention settings must be positive integers")
        return value
