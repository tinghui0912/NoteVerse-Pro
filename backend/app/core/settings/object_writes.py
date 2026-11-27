"""Server write leases and durable unadopted-byte cleanup policy."""

from pydantic import BaseModel, field_validator


class ObjectWriteSettings(BaseModel):
    OBJECT_WRITE_INTENT_LEASE_SECONDS: int = 900
    OBJECT_WRITE_CLEANUP_DISPATCH_INTERVAL_SECONDS: int = 30
    OBJECT_WRITE_CLEANUP_DISPATCH_TIMEOUT_SECONDS: int = 300
    OBJECT_WRITE_CLEANUP_PROCESSING_TIMEOUT_SECONDS: int = 300
    OBJECT_WRITE_CLEANUP_RETRY_BASE_SECONDS: int = 60
    OBJECT_WRITE_CLEANUP_MAX_ATTEMPTS: int = 5
    OBJECT_WRITE_CLEANUP_DISPATCH_BATCH_SIZE: int = 50

    @field_validator(
        "OBJECT_WRITE_INTENT_LEASE_SECONDS",
        "OBJECT_WRITE_CLEANUP_DISPATCH_INTERVAL_SECONDS",
        "OBJECT_WRITE_CLEANUP_DISPATCH_TIMEOUT_SECONDS",
        "OBJECT_WRITE_CLEANUP_PROCESSING_TIMEOUT_SECONDS",
        "OBJECT_WRITE_CLEANUP_RETRY_BASE_SECONDS",
        "OBJECT_WRITE_CLEANUP_MAX_ATTEMPTS",
        "OBJECT_WRITE_CLEANUP_DISPATCH_BATCH_SIZE",
    )
    @classmethod
    def positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("object write policy must be positive")
        return value
