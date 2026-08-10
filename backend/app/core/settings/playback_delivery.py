"""Playback outbox delivery settings."""

from pydantic import BaseModel, field_validator


class PlaybackDeliverySettings(BaseModel):
    """Shared policy for playback asset delivery retries and leases."""

    PLAYBACK_OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 30
    PLAYBACK_OUTBOX_DISPATCH_TIMEOUT_SECONDS: int = 300
    PLAYBACK_OUTBOX_PROCESSING_TIMEOUT_SECONDS: int = 1200
    PLAYBACK_OUTBOX_RETRY_BASE_SECONDS: int = 60
    PLAYBACK_OUTBOX_MAX_ATTEMPTS: int = 5
    PLAYBACK_OUTBOX_DISPATCH_BATCH_SIZE: int = 50

    @field_validator(
        "PLAYBACK_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "PLAYBACK_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "PLAYBACK_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "PLAYBACK_OUTBOX_RETRY_BASE_SECONDS",
        "PLAYBACK_OUTBOX_MAX_ATTEMPTS",
        "PLAYBACK_OUTBOX_DISPATCH_BATCH_SIZE",
    )
    @classmethod
    def validate_positive_playback_delivery_setting(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("playback delivery settings must be positive integers")
        return value
