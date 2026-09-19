"""Tests for model asset access endpoint and presigned delivery."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.db.models.user import User
from app.main import app
from app.modules.model_assets.service import ModelAssetService


def test_model_asset_access_unauthenticated_returns_401(client: TestClient) -> None:
    """Unauthenticated requests must be rejected with 401."""
    response = client.get("/api/v1/model-assets/bytedance-note/access")
    assert response.status_code == 401


def test_model_asset_access_authenticated_returns_descriptor() -> None:
    """Authenticated requests return 200 with full access descriptor."""
    dummy_user = User(
        id=42,
        email="pianist@example.com",
        username="pianist",
        is_active=True,
    )

    app.dependency_overrides[get_current_user] = lambda: dummy_user
    try:
        with TestClient(app) as client:
            response = client.get("/api/v1/model-assets/bytedance-note/access")
            assert response.status_code == 200

            body = response.json()
            assert body.get("success") is True
            data = body.get("data")
            assert isinstance(data, dict)

            assert data["schemaVersion"] == 1
            assert data["assetId"] == "bytedance-piano-transcription-note-model"
            assert data["assetVersion"] == "CRNN_note_F1_0.9677_pedal_F1_0.9186"
            assert data["expectedByteSize"] == 98_691_493
            assert data["sha256"] == "6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5"
            assert data["mediaType"] == "application/octet-stream"

            download_url = data["downloadUrl"]
            assert download_url.startswith("https://")
            assert settings.ALIYUN_OSS_MODEL_BUCKET in download_url
            assert "model.onnx" in download_url
            assert "X-Amz-Signature=" in download_url or "Signature=" in download_url or "OSSAccessKeyId=" in download_url

            expires_at_str = data["downloadUrlExpiresAt"]
            expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            delta = (expires_at - now).total_seconds()
            assert 3500 <= delta <= 3700
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_model_asset_service_unit() -> None:
    """Service directly creates valid signed URLs and descriptor."""
    service = ModelAssetService(
        bucket="noteverse-model-assets",
        region="cn-shenzhen",
        object_key="models/bytedance/piano-note/6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5/model.onnx",
        ttl_seconds=3600,
    )
    access = service.get_bytedance_note_model_access()
    assert access.schemaVersion == 1
    assert access.expectedByteSize == 98_691_493
    assert access.sha256 == "6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5"
    assert access.downloadUrl.startswith("https://")
    assert "noteverse-model-assets" in access.downloadUrl
