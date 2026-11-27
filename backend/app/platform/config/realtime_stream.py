"""Realtime HTTP event-stream settings."""

from pydantic import BaseModel, field_validator


class RealtimeStreamSettings(BaseModel):
    """Shared policy for SSE catch-up cadence, heartbeats, and page size."""

    REALTIME_EVENT_CATCHUP_INTERVAL_SECONDS: int = 2
    REALTIME_EVENT_HEARTBEAT_INTERVAL_SECONDS: int = 15
    REALTIME_EVENT_BATCH_SIZE: int = 100

    @field_validator(
        "REALTIME_EVENT_CATCHUP_INTERVAL_SECONDS",
        "REALTIME_EVENT_HEARTBEAT_INTERVAL_SECONDS",
        "REALTIME_EVENT_BATCH_SIZE",
    )
    @classmethod
    def validate_positive_realtime_stream_setting(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("realtime stream settings must be positive integers")
        return value
