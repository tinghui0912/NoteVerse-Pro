"""Score Revision Render delivery settings."""

from pydantic import BaseModel, field_validator


class RevisionRenderDeliverySettings(BaseModel):
    """Revision render retry, dispatch and processing lease policy."""

    REVISION_RENDER_DISPATCH_INTERVAL_SECONDS: int = 30
    REVISION_RENDER_DISPATCH_TIMEOUT_SECONDS: int = 300
    REVISION_RENDER_PROCESSING_TIMEOUT_SECONDS: int = 1200
    REVISION_RENDER_RETRY_BASE_SECONDS: int = 60
    REVISION_RENDER_MAX_ATTEMPTS: int = 5
    REVISION_RENDER_DISPATCH_BATCH_SIZE: int = 50

    @field_validator(
        "REVISION_RENDER_DISPATCH_INTERVAL_SECONDS",
        "REVISION_RENDER_DISPATCH_TIMEOUT_SECONDS",
        "REVISION_RENDER_PROCESSING_TIMEOUT_SECONDS",
        "REVISION_RENDER_RETRY_BASE_SECONDS",
        "REVISION_RENDER_MAX_ATTEMPTS",
        "REVISION_RENDER_DISPATCH_BATCH_SIZE",
    )
    @classmethod
    def validate_positive_revision_render_delivery_setting(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("revision render delivery settings must be positive integers")
        return value
