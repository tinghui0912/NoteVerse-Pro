"""Service for generating presigned model asset access descriptors using Alibaba Cloud OSS SDK V2."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import alibabacloud_oss_v2 as oss

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
        client: oss.Client | None = None,
    ) -> None:
        self.bucket = bucket or settings.ALIYUN_OSS_MODEL_BUCKET
        self.region = region or settings.ALIYUN_OSS_MODEL_REGION
        self.object_key = object_key or settings.BYTEDANCE_MODEL_OBJECT_KEY
        self.ttl_seconds = (
            ttl_seconds
            if ttl_seconds is not None
            else settings.MODEL_ASSET_SIGNED_GET_TTL_SECONDS
        )
        self._client = client

    @property
    def client(self) -> oss.Client:
        """Lazily initialize Alibaba Cloud OSS SDK V2 client with Signature V4."""
        if self._client is not None:
            return self._client

        ak = os.environ.get("OSS_ACCESS_KEY_ID") or settings.S3_ACCESS_KEY_ID
        sk = os.environ.get("OSS_ACCESS_KEY_SECRET") or settings.S3_SECRET_ACCESS_KEY

        cfg = oss.config.load_default()
        cfg.credentials_provider = oss.credentials.StaticCredentialsProvider(ak, sk)
        cfg.region = self.region
        self._client = oss.Client(cfg)
        return self._client

    def get_bytedance_note_model_access(self) -> ModelAssetAccessRead:
        """Generate short-lived presigned GET descriptor for the ByteDance ONNX note model."""
        request = oss.models.GetObjectRequest(
            bucket=self.bucket,
            key=self.object_key,
        )

        presign_result = self.client.presign(
            request,
            expires=timedelta(seconds=self.ttl_seconds),
        )

        expiration_dt = presign_result.expiration
        if not isinstance(expiration_dt, datetime):
            raise RuntimeError(f"Unexpected presign expiration type: {type(expiration_dt)}")

        expires_at = (
            expiration_dt.astimezone(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )

        return ModelAssetAccessRead(
            downloadUrl=presign_result.url,
            downloadUrlExpiresAt=expires_at,
        )


_default_service: Optional[ModelAssetService] = None


def get_model_asset_service() -> ModelAssetService:
    global _default_service
    if _default_service is None:
        _default_service = ModelAssetService()
    return _default_service
