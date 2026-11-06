"""Network-free current delivery and strict descriptor conformance."""

from tests.support.object_storage import InMemoryObjectStorage
import pytest
from pydantic import ValidationError
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.api.deps import get_current_user
from app.modules.model_assets.generated.practice_acoustic_contract import (
    MODEL_ASSET,
    MODEL_ASSET_DESCRIPTOR,
)
from app.modules.model_assets.schemas import PracticeAcousticAccessRead
from app.modules.model_assets.service import ModelAssetService, get_model_asset_service
from app.modules.model_assets.router import router


def delivery():
    return ModelAssetService(storage=InMemoryObjectStorage())


def test_current_delivery_matches_canonical_descriptor_and_content_addressed_key():
    access = delivery().get_practice_acoustic_access()
    assert access.model_dump(include=set(MODEL_ASSET_DESCRIPTOR)) == dict(MODEL_ASSET_DESCRIPTOR)
    assert MODEL_ASSET.storage_key in access.downloadUrl
    assert access.downloadUrl.startswith("https://objects.example/")


@pytest.mark.parametrize(
    "field,value",
    [
        ("schemaVersion", 2),
        ("assetId", "unconfigured"),
        ("assetVersion", "unconfigured"),
        ("expectedByteSize", MODEL_ASSET.byte_size + 1),
        ("sha256", "0" * 64),
        ("mediaType", "text/plain"),
        ("extra", True),
    ],
)
def test_access_schema_rejects_descriptor_mismatch(field, value):
    data = {
        **MODEL_ASSET_DESCRIPTOR,
        "downloadUrl": "https://example.invalid/model",
        "downloadUrlExpiresAt": "future",
    }
    with pytest.raises(ValidationError):
        PracticeAcousticAccessRead.model_validate({**data, field: value})


def test_authenticated_current_delivery_over_http():
    application = FastAPI()
    application.include_router(router, prefix="/model-assets")
    application.dependency_overrides[get_current_user] = lambda: object()
    application.dependency_overrides[get_model_asset_service] = delivery
    with TestClient(application) as client:
        response = client.get("/model-assets/practice-acoustic/access")
        assert response.status_code == 200
        data = response.json()["data"]
        assert {key: data[key] for key in MODEL_ASSET_DESCRIPTOR} == dict(MODEL_ASSET_DESCRIPTOR)
