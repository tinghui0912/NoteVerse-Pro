"""Render outbox delivery and derived-asset retention settings."""

from pydantic import BaseModel, field_validator


class RenderAssetDeliverySettings(BaseModel):
    """Shared policy for render retries, leases, cleanup, and retention."""

    RENDER_OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 30
    RENDER_OUTBOX_DISPATCH_TIMEOUT_SECONDS: int = 300
    RENDER_OUTBOX_PROCESSING_TIMEOUT_SECONDS: int = 1200
    RENDER_OUTBOX_RETRY_BASE_SECONDS: int = 60
    RENDER_OUTBOX_MAX_ATTEMPTS: int = 5
    RENDER_OUTBOX_DISPATCH_BATCH_SIZE: int = 50
    DERIVED_ASSET_RETAIN_RECENT_REVISIONS: int = 10
    DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS: int = 86400

    @field_validator(
        "RENDER_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "RENDER_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "RENDER_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "RENDER_OUTBOX_RETRY_BASE_SECONDS",
        "RENDER_OUTBOX_MAX_ATTEMPTS",
        "RENDER_OUTBOX_DISPATCH_BATCH_SIZE",
        "DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS",
    )
    @classmethod
    def validate_positive_render_asset_delivery_setting(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("render asset delivery settings must be positive integers")
        return value

    @field_validator("DERIVED_ASSET_RETAIN_RECENT_REVISIONS")
    @classmethod
    def validate_derived_asset_retention_count(cls, value: int) -> int:
        if value < 0:
            raise ValueError("DERIVED_ASSET_RETAIN_RECENT_REVISIONS must be non-negative")
        return value
