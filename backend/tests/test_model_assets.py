"""Tests for authenticated object-store model delivery."""

from __future__ import annotations


from tests.support.runtime_resources import resources_for


from tests.support.http_errors import CUSTOMER_HTTP_ERRORS

import datetime
from datetime import UTC, timedelta, timezone

import pytest
from pydantic import ValidationError

from tests.support.object_storage import InMemoryObjectStorage
from fastapi.testclient import TestClient
from app.core.http_application import HttpApplication

from app.runtime.customer_api.deps import get_current_user
from app.db.models.user import User
from app.runtime.customer_api.routers.model_assets.router import router
from app.runtime.customer_api.resources import get_model_asset_service
from app.modules.model_assets.service import ModelAssetService
from app.modules.model_assets.schemas import PracticeAcousticAccessRead
from app.modules.model_assets.generated.practice_acoustic_model_asset import MODEL_ASSET_DESCRIPTOR
from app.core.exception_handlers import register_exception_handlers
from app.platform.config.model_asset_delivery import ModelAssetDeliverySettings

from app.runtime.customer_api.context import get_context

app = HttpApplication()
app.state.settings = get_context().settings
app.state.session_factory = get_context().sessions
register_exception_handlers(app, **CUSTOMER_HTTP_ERRORS)
app.include_router(router, prefix="/api/v1/model-assets")


def create_test_model_asset_service() -> ModelAssetService:
    return ModelAssetService(
        ttl_seconds=3600,
        delivery=resources_for(InMemoryObjectStorage()).build_media_delivery_service(),
        config=ModelAssetDeliverySettings(),
    )


def test_model_asset_access_unauthenticated_returns_401() -> None:
    """Unauthenticated requests must be rejected with 401."""
    with TestClient(app) as client:
        response = client.get("/api/v1/model-assets/practice-acoustic/access")
        assert response.status_code == 401


def test_model_asset_access_authenticated_returns_descriptor() -> None:
    """Authenticated requests return 200 with the current access descriptor."""
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
            data = body
            assert isinstance(data, dict)

            assert {key: data[key] for key in MODEL_ASSET_DESCRIPTOR} == dict(
                MODEL_ASSET_DESCRIPTOR
            )

            download_url = data["downloadUrl"]
            assert download_url.startswith("https://objects.example/")
            assert "model.onnx" in download_url

            expires_at_str = data["downloadUrlExpiresAt"]
            expires_at = datetime.datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
            assert expires_at.utcoffset() == timedelta(0)
            now = datetime.datetime.now(timezone.utc)
            delta = (expires_at - now).total_seconds()
            assert 3500 <= delta <= 3700
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_model_asset_service, None)


def test_model_asset_service_unit(monkeypatch) -> None:
    """Service directly creates valid signed URLs through ObjectStorage."""
    service = create_test_model_asset_service()
    now = datetime.datetime(2026, 11, 15, 10, tzinfo=UTC)
    monkeypatch.setattr("app.modules.model_assets.service.utc_now", lambda: now)
    access = service.get_practice_acoustic_access()

    assert access.model_dump(include=set(MODEL_ASSET_DESCRIPTOR)) == dict(MODEL_ASSET_DESCRIPTOR)

    assert access.downloadUrl.startswith("https://objects.example/")
    assert isinstance(access.downloadUrlExpiresAt, datetime.datetime)
    assert access.downloadUrlExpiresAt == now + timedelta(seconds=3600)
    assert access.downloadUrlExpiresAt.utcoffset() == timedelta(0)


def test_model_asset_expiry_normalizes_an_explicit_offset():
    source = datetime.datetime(2026, 11, 15, 18, tzinfo=timezone(timedelta(hours=8)))
    access = PracticeAcousticAccessRead(
        **MODEL_ASSET_DESCRIPTOR,
        downloadUrl="https://objects.example/model.onnx",
        downloadUrlExpiresAt=source,
    )
    assert access.downloadUrlExpiresAt == source
    assert access.downloadUrlExpiresAt.utcoffset() == timedelta(0)
    wire = datetime.datetime.fromisoformat(access.model_dump(mode="json")["downloadUrlExpiresAt"])
    assert wire == source and wire.utcoffset() == timedelta(0)


def test_model_asset_expiry_requires_an_aware_programming_value():
    with pytest.raises(ValidationError):
        PracticeAcousticAccessRead(
            **MODEL_ASSET_DESCRIPTOR,
            downloadUrl="https://objects.example/model.onnx",
            downloadUrlExpiresAt=datetime.datetime(2026, 11, 15, 10),
        )


def test_model_asset_expiry_openapi_is_a_date_time_instant():
    schema = app.openapi()["components"]["schemas"]["PracticeAcousticAccessRead"]
    value = schema["properties"]["downloadUrlExpiresAt"]
    assert value["type"] == "string" and value["format"] == "date-time"
    assert "downloadUrlExpiresAt" in schema["required"]
