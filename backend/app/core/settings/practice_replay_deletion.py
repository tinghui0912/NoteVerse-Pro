"""Durable deletion policy for user-saved practice replay objects."""

from pydantic import BaseModel, field_validator


class PracticeReplayDeletionSettings(BaseModel):
    PRACTICE_REPLAY_DELETE_OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 30
    PRACTICE_REPLAY_DELETE_OUTBOX_DISPATCH_TIMEOUT_SECONDS: int = 300
    PRACTICE_REPLAY_DELETE_OUTBOX_PROCESSING_TIMEOUT_SECONDS: int = 300
    PRACTICE_REPLAY_DELETE_OUTBOX_RETRY_BASE_SECONDS: int = 60
    PRACTICE_REPLAY_DELETE_OUTBOX_MAX_ATTEMPTS: int = 5
    PRACTICE_REPLAY_DELETE_OUTBOX_DISPATCH_BATCH_SIZE: int = 50

    @field_validator(
        "PRACTICE_REPLAY_DELETE_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "PRACTICE_REPLAY_DELETE_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "PRACTICE_REPLAY_DELETE_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "PRACTICE_REPLAY_DELETE_OUTBOX_RETRY_BASE_SECONDS",
        "PRACTICE_REPLAY_DELETE_OUTBOX_MAX_ATTEMPTS",
        "PRACTICE_REPLAY_DELETE_OUTBOX_DISPATCH_BATCH_SIZE",
    )
    @classmethod
    def validate_positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("practice replay deletion outbox settings must be positive")
        return value
