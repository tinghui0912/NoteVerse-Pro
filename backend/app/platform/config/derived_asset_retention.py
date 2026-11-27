"""Retention scheduling for rebuildable Score derived assets."""

from app.platform.config.maintenance_defaults import DEFAULT_DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS


from pydantic import BaseModel, field_validator


class DerivedAssetRetentionSettings(BaseModel):
    DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS: int = DEFAULT_DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS

    @field_validator("DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS")
    @classmethod
    def positive_interval(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("derived asset cleanup interval must be positive")
        return value
