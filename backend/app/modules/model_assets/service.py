"""Service for generating presigned model asset access descriptors."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.config import settings
from app.modules.model_assets.schemas import ModelAssetAccessRead


class ModelAssetService:
    """Provides authenticated clients with short-lived presigned access to model assets."""

    def __init__(
        self,
        bucket: str | None = None,
        region: str | None = None,
        object_key: str | None = None,
        ttl_seconds: int | None = None,
    ) -> None:
        self.bucket = bucket or settings.ALIYUN_OSS_MODEL_BUCKET
        self.region = region or settings.ALIYUN_OSS_MODEL_REGION
        self.object_key = object_key or settings.BYTEDANCE_MODEL_OBJECT_KEY
        self.ttl_seconds = (
            ttl_seconds
            if ttl_seconds is not None
            else settings.MODEL_ASSET_SIGNED_GET_TTL_SECONDS
        )
        self._client = None

    @property
    def client(self):
        """Lazily initialize boto3 S3 client with virtual-host addressing."""
        if self._client is not None:
            return self._client

        import boto3
        from botocore.config import Config

        endpoint_url = settings.S3_ENDPOINT_URL or f"https://oss-{self.region}.aliyuncs.com"
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=self.region,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "virtual"},
            ),
        )
        return self._client

    def get_bytedance_note_model_access(self) -> ModelAssetAccessRead:
        """Generate short-lived presigned GET descriptor for the ByteDance ONNX note model."""
        now = datetime.now(timezone.utc)
        expires_at = (now + timedelta(seconds=self.ttl_seconds)).isoformat().replace("+00:00", "Z")

        download_url = self.client.generate_presigned_url(
            ClientMethod="get_object",
            Params={
                "Bucket": self.bucket,
                "Key": self.object_key,
            },
            ExpiresIn=self.ttl_seconds,
        )

        return ModelAssetAccessRead(
            downloadUrl=download_url,
            downloadUrlExpiresAt=expires_at,
        )


_default_service: Optional[ModelAssetService] = None


def get_model_asset_service() -> ModelAssetService:
    global _default_service
    if _default_service is None:
        _default_service = ModelAssetService()
    return _default_service
