"""Tests for model asset access endpoint and presigned delivery using Alibaba Cloud OSS SDK V2."""

from __future__ import annotations

import datetime
from datetime import timezone

import alibabacloud_oss_v2 as oss
from fastapi.testclient import TestClient
from fastapi import FastAPI

from app.api.deps import get_current_user
from app.db.models.user import User
from app.modules.model_assets.router import get_model_asset_service, router
from app.modules.model_assets.service import ModelAssetService
from app.modules.model_assets.generated.practice_acoustic_contract import MODEL_ASSET_DESCRIPTOR
from app.core.exception_handlers import register_exception_handlers

app = FastAPI()
register_exception_handlers(app)
app.include_router(router, prefix="/api/v1/model-assets")


def create_test_model_asset_service() -> ModelAssetService:
    """Create a ModelAssetService with offline credentials for hermetic testing."""
    cfg = oss.config.load_default()
    cfg.credentials_provider = oss.credentials.StaticCredentialsProvider(
        "test-ak-id", "test-ak-secret"
    )
    cfg.region = "cn-shenzhen"
    client = oss.Client(cfg)
    return ModelAssetService(
        bucket="noteverse-model-assets",
        region="cn-shenzhen",
        ttl_seconds=3600,
        client=client,
    )


def test_model_asset_access_unauthenticated_returns_401() -> None:
    """Unauthenticated requests must be rejected with 401."""
    with TestClient(app) as client:
        response = client.get("/api/v1/model-assets/practice-acoustic/access")
        assert response.status_code == 401


def test_model_asset_access_authenticated_returns_descriptor() -> None:
    """Authenticated requests return 200 with full access descriptor and OSS V4 signatures."""
    dummy_user = User(
        id=42,
        email="pianist@example.com",
        username="pianist",
        is_active=True,
    )

    test_service = create_test_model_asset_service()
    app.dependency_overrides[get_current_user] = lambda: dummy_user
    app.dependency_overrides[get_model_asset_service] = lambda: test_service

    try:
        with TestClient(app) as client:
            response = client.get("/api/v1/model-assets/practice-acoustic/access")
            assert response.status_code == 200

            body = response.json()
            assert body.get("success") is True
            data = body.get("data")
            assert isinstance(data, dict)

            assert {key: data[key] for key in MODEL_ASSET_DESCRIPTOR} == dict(
                MODEL_ASSET_DESCRIPTOR
            )

            download_url = data["downloadUrl"]
            assert download_url.startswith(
                "https://noteverse-model-assets.oss-cn-shenzhen.aliyuncs.com/"
            )
            assert "model.onnx" in download_url

            # Native Alibaba Cloud OSS V4 signature fields required
            assert "x-oss-signature-version=OSS4-HMAC-SHA256" in download_url
            assert "x-oss-date=" in download_url
            assert "x-oss-expires=" in download_url
            assert "x-oss-credential=" in download_url
            assert "x-oss-signature=" in download_url

            # Rejection of AWS S3 SigV4 tokens
            assert "X-Amz-Signature" not in download_url
            assert "AWS4-HMAC-SHA256" not in download_url

            expires_at_str = data["downloadUrlExpiresAt"]
            expires_at = datetime.datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
            now = datetime.datetime.now(timezone.utc)
            delta = (expires_at - now).total_seconds()
            assert 3500 <= delta <= 3700
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_model_asset_service, None)


def test_model_asset_service_unit() -> None:
    """Service directly creates valid signed URLs with OSS SDK V2 Signature V4."""
    service = create_test_model_asset_service()
    access = service.get_practice_acoustic_access()

    assert access.model_dump(include=set(MODEL_ASSET_DESCRIPTOR)) == dict(MODEL_ASSET_DESCRIPTOR)

    assert access.downloadUrl.startswith(
        "https://noteverse-model-assets.oss-cn-shenzhen.aliyuncs.com/"
    )
    assert "x-oss-signature-version=OSS4-HMAC-SHA256" in access.downloadUrl
    assert "x-oss-signature=" in access.downloadUrl
    assert "X-Amz-Signature" not in access.downloadUrl
