"""Model asset delivery and presigned access settings."""

from pydantic import BaseModel, field_validator


class ModelAssetDeliverySettings(BaseModel):
    """Configuration for private object storage model asset delivery."""

    ALIYUN_OSS_MODEL_BUCKET: str = "noteverse-model-assets"
    ALIYUN_OSS_MODEL_REGION: str = "cn-shenzhen"
    BYTEDANCE_MODEL_OBJECT_KEY: str = (
        "models/bytedance/piano-note/6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5/model.onnx"
    )
    MODEL_ASSET_SIGNED_GET_TTL_SECONDS: int = 3600

    @field_validator("MODEL_ASSET_SIGNED_GET_TTL_SECONDS")
    @classmethod
    def validate_ttl_seconds(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("MODEL_ASSET_SIGNED_GET_TTL_SECONDS must be positive")
        return value
