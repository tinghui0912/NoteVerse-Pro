"""Durable retirement delivery policy for physical objects."""

from pydantic import BaseModel, field_validator


class StoredObjectRetirementSettings(BaseModel):
    STORED_OBJECT_RETIREMENT_DISPATCH_INTERVAL_SECONDS: int = 30
    STORED_OBJECT_RETIREMENT_DISPATCH_TIMEOUT_SECONDS: int = 300
    STORED_OBJECT_RETIREMENT_PROCESSING_TIMEOUT_SECONDS: int = 300
    STORED_OBJECT_RETIREMENT_RETRY_BASE_SECONDS: int = 60
    STORED_OBJECT_RETIREMENT_MAX_ATTEMPTS: int = 5
    STORED_OBJECT_RETIREMENT_DISPATCH_BATCH_SIZE: int = 50

    PRACTICE_BUNDLE_GC_BATCH_SIZE: int = 50

    @field_validator(
        "PRACTICE_BUNDLE_GC_BATCH_SIZE",
        "STORED_OBJECT_RETIREMENT_DISPATCH_INTERVAL_SECONDS",
        "STORED_OBJECT_RETIREMENT_DISPATCH_TIMEOUT_SECONDS",
        "STORED_OBJECT_RETIREMENT_PROCESSING_TIMEOUT_SECONDS",
        "STORED_OBJECT_RETIREMENT_RETRY_BASE_SECONDS",
        "STORED_OBJECT_RETIREMENT_MAX_ATTEMPTS",
        "STORED_OBJECT_RETIREMENT_DISPATCH_BATCH_SIZE",
    )
    @classmethod
    def validate_positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("stored object retirement settings must be positive")
        return value
