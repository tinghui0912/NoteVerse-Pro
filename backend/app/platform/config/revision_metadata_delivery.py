"""Revision metadata delivery scheduling, retry and lease policy."""

from app.platform.config.maintenance_defaults import (
    DEFAULT_REVISION_METADATA_DISPATCH_INTERVAL_SECONDS,
)


from pydantic import BaseModel, field_validator


class RevisionMetadataDeliverySettings(BaseModel):
    REVISION_METADATA_DISPATCH_INTERVAL_SECONDS: int = (
        DEFAULT_REVISION_METADATA_DISPATCH_INTERVAL_SECONDS
    )
    REVISION_METADATA_DISPATCH_BATCH_SIZE: int = 50
    REVISION_METADATA_MAX_ATTEMPTS: int = 5
    REVISION_METADATA_RETRY_BASE_SECONDS: int = 60
    REVISION_METADATA_DISPATCH_TIMEOUT_SECONDS: int = 300
    REVISION_METADATA_PROCESSING_TIMEOUT_SECONDS: int = 300

    @field_validator(
        "REVISION_METADATA_DISPATCH_INTERVAL_SECONDS",
        "REVISION_METADATA_DISPATCH_BATCH_SIZE",
        "REVISION_METADATA_MAX_ATTEMPTS",
        "REVISION_METADATA_RETRY_BASE_SECONDS",
        "REVISION_METADATA_DISPATCH_TIMEOUT_SECONDS",
        "REVISION_METADATA_PROCESSING_TIMEOUT_SECONDS",
    )
    @classmethod
    def validate_positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("revision metadata delivery settings must be positive")
        return value
