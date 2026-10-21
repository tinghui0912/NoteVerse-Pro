"""Durable deletion policy for user-saved performance take objects."""

from pydantic import BaseModel, field_validator


class PerformanceTakeDeletionSettings(BaseModel):
    PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 30
    PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_TIMEOUT_SECONDS: int = 300
    PERFORMANCE_TAKE_DELETE_OUTBOX_PROCESSING_TIMEOUT_SECONDS: int = 300
    PERFORMANCE_TAKE_DELETE_OUTBOX_RETRY_BASE_SECONDS: int = 60
    PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS: int = 5
    PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_BATCH_SIZE: int = 50

    @field_validator(
        "PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "PERFORMANCE_TAKE_DELETE_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "PERFORMANCE_TAKE_DELETE_OUTBOX_RETRY_BASE_SECONDS",
        "PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS",
        "PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_BATCH_SIZE",
    )
    @classmethod
    def validate_positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("performance take deletion outbox settings must be positive")
        return value
