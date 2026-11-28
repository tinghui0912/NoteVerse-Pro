"""Model asset delivery and presigned access settings."""

from pydantic import BaseModel, field_validator


class ModelAssetDeliverySettings(BaseModel):
    """Configuration for private object storage model asset delivery."""

    MODEL_ASSET_SIGNED_GET_TTL_SECONDS: int = 3600

    @field_validator("MODEL_ASSET_SIGNED_GET_TTL_SECONDS")
    @classmethod
    def validate_ttl_seconds(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("MODEL_ASSET_SIGNED_GET_TTL_SECONDS must be positive")
        return value
