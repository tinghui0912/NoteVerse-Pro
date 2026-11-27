"""Take API commands expose upload sessions, immutable manifests and signed delivery."""

from tests.support.runtime_resources import resources_for

from tests.support.practice_bundle import bind_bundle


from tests.support.take_fixtures import (
    DEFAULT_TAKE_ARTIFACT_ID,
    DEFAULT_TAKE_RECORDING_TIMEBASE,
    DEFAULT_TAKE_REVISION_ID,
    PracticeBundleRecord,
    VALID_WEBM_BYTES,
    _bundle_id,
    _canonical_bundle,
    _create_default_bundle,
    _create_default_take,
    _performance_take_service,
    _reservation_request_payload,
    canonical_practice_artifact_bytes,
    json,
)
from tests.support.take_fixtures import test_env as test_env
from app.shared.error_codes import CustomerErrorCode
from app.core.exceptions import ValidationException
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.practice.bundle.repository import PracticeBundleRepository
from app.modules.practice.bundle.content import read_verified_bundle

import pytest
from fastapi.testclient import TestClient
from app.runtime.customer_api.main import app
from app.platform.db.dependencies import get_db
from app.runtime.customer_api.deps import get_current_user
from app.runtime.customer_api.resources import (
    get_performance_take_service,
    get_performance_take_reservation_service,
    get_performance_take_finalization_service,
    get_upload_session_service,
)
from app.db.models import (
    User,
    PerformanceTake,
    PerformanceTakeUploadReservation,
    StorageUsageAccount,
)
from app.modules.performance_takes.schemas import PerformanceTakeUploadReservationRequest
from app.storage.base import DirectUploadTarget
from sqlalchemy import select


@pytest.fixture
def take_api(test_env):
    db, storage, user, _ = test_env
    services = _performance_take_service(session=db, storage=storage)
    app.dependency_overrides.update(
        {
            get_db: lambda: db,
            get_current_user: lambda: db.get(User, 1),
            get_performance_take_service: lambda: services.takes,
            get_performance_take_reservation_service: lambda: services,
            get_performance_take_finalization_service: lambda: services,
            get_upload_session_service: lambda: services.uploads,
        }
    )
    try:
        with TestClient(app) as client:
            yield client, db, storage, services
    finally:
        app.dependency_overrides.clear()


def test_api_reserves_completes_finalizes_replays_and_delivers_signed_urls(take_api):
    client, db, storage, services = take_api
    payload = _reservation_request_payload(
        {
            "client_request_id": "recording",
            "media": {"byte_size": len(VALID_WEBM_BYTES), "mime_type": "audio/webm"},
        }
    )
    reserved = client.post("/api/v1/performance-takes/upload-reservations", json=payload)
    assert reserved.status_code == 200, reserved.text
    reservation = reserved.json()
    transfer = reservation["upload_session"]
    target = transfer["upload_target"]
    storage.receive_upload(
        DirectUploadTarget(target["url"], target["method"], target["headers"]), VALID_WEBM_BYTES
    )
    complete = client.post(f"/api/v1/upload-sessions/{transfer['session_id']}/complete")
    assert complete.status_code == 200, complete.text
    path = f"/api/v1/performance-takes/upload-reservations/{reservation['reservation_id']}/finalize"
    result = client.post(path)
    assert result.status_code == 200, result.text
    take = result.json()
    assert take["media_status"] == "READY"
    assert client.post(path).json() == take
    access = client.get(f"/api/v1/performance-takes/{take['take_id']}/playback-url")
    assert access.status_code == 200 and access.json()["playback_url"].startswith(
        "https://objects.example/"
    )
    assert access.json()["expires_in"] == 900
    assert client.get(f"/api/v1/performance-takes/{take['take_id']}/media").status_code == 404
    assert client.delete(f"/api/v1/performance-takes/{take['take_id']}").status_code == 204
    assert db.scalar(select(PerformanceTake)) is None
    assert db.get(StorageUsageAccount, 1).used_bytes == 0
    assert db.scalar(select(PerformanceTakeUploadReservation)) is not None


@pytest.mark.parametrize(
    "field,value", [("byte_size", 500 * 1024**2 + 1), ("mime_type", "application/octet-stream")]
)
def test_invalid_capture_has_no_reservation_or_capacity(take_api, field, value):
    client, db, storage, services = take_api
    payload = _reservation_request_payload(
        {
            "client_request_id": "invalid",
            "media": {"byte_size": len(VALID_WEBM_BYTES), "mime_type": "audio/webm"},
        }
    )
    payload["media"][field] = value
    response = client.post("/api/v1/performance-takes/upload-reservations", json=payload)
    assert response.status_code == 422, response.text
    assert db.scalar(select(PerformanceTakeUploadReservation)) is None


def test_session_capabilities_require_authenticated_active_owner(take_api):
    client, db, storage, services = take_api
    payload = _reservation_request_payload(
        {
            "client_request_id": "private",
            "media": {"byte_size": len(VALID_WEBM_BYTES), "mime_type": "audio/webm"},
        }
    )
    accepted = client.post("/api/v1/performance-takes/upload-reservations", json=payload).json()
    app.dependency_overrides[get_current_user] = lambda: db.get(User, 2)
    response = client.get("/api/v1/upload-sessions/" + accepted["upload_session"]["session_id"])
    assert response.status_code == 409


def test_invalid_stored_scope_reports_validation_error(test_env):
    session, storage, user, _ = test_env
    source = _create_default_bundle(session, storage)
    take = _create_default_take(
        session,
        user_id=user.id,
        source=source,
        client_request_id="invalid-stored-scope",
        take_uuid="invalid-stored-scope",
        media_object_key="test/invalid-stored-scope.webm",
    )
    document = json.loads(take.manifest.manifest_json)
    document["manifest"]["scope"]["kind"] = "INVALID"
    take.manifest.manifest_json = json.dumps(document)
    service = PerformanceTakeService(
        usage=resources_for(storage).build_revision_writer().usage,
        delivery=resources_for(storage).build_media_delivery_service(),
    )
    with pytest.raises(ValidationException) as raised:
        service._to_read_dto(take)
    assert raised.value.code == CustomerErrorCode.VALIDATION_ERROR
    assert raised.value.details == {"field": "manifest", "reason": "invalid_manifest"}


def test_bundle_materialization_stores_and_reuses_exact_content(test_env):
    session, storage, _, _ = test_env
    value = _canonical_bundle("score-uuid-10", DEFAULT_TAKE_REVISION_ID, DEFAULT_TAKE_ARTIFACT_ID)
    first, verified = bind_bundle(session, storage, value, revision_id=100)
    second, reused = bind_bundle(session, storage, value, revision_id=100)
    assert first == second and verified == reused == value
    row = session.get(PracticeBundleRecord, first.id)
    assert (
        storage.read_bytes(row.prepared_musicxml_object.object_key) == value.prepared_musicxml.data
    )
    assert storage.read_bytes(row.artifact_object.object_key) == value.artifact.representation.data


@pytest.mark.parametrize("representation", ["prepared_musicxml", "artifact"])
def test_practice_bundle_checksum_corruption_is_rejected(test_env, representation):
    session, storage, _, _ = test_env
    row = _create_default_bundle(session, storage)
    key = getattr(row, f"{representation}_object").object_key
    storage.put_bytes(key=key, content=b"corrupt", content_type="application/octet-stream")
    with pytest.raises(ValidationException) as caught:
        read_verified_bundle(
            storage, PracticeBundleRepository().read_by_bundle_id(session, row.bundle_id)
        )
    assert caught.value.details["reason"] == f"{representation}_checksum_mismatch"


def test_practice_bundle_artifact_identity_corruption_is_rejected(test_env):
    session, storage, _, _ = test_env
    row = _create_default_bundle(session, storage)
    from app.modules.practice.bundle.domain import PracticeBundleRepresentation

    value = _canonical_bundle(
        "score-uuid-10", DEFAULT_TAKE_REVISION_ID, DEFAULT_TAKE_ARTIFACT_ID
    ).artifact.value
    value["artifactId"] = "practice-score-artifact:0000000000000000"
    changed = PracticeBundleRepresentation(
        canonical_practice_artifact_bytes(value), "application/json"
    )
    storage.put_bytes(
        key=row.artifact_object.object_key, content=changed.data, content_type=changed.mime_type
    )
    row.artifact_object.sha256 = changed.sha256
    row.artifact_object.byte_size = changed.byte_size
    session.commit()
    with pytest.raises(ValidationException) as caught:
        read_verified_bundle(
            storage, PracticeBundleRepository().read_by_bundle_id(session, row.bundle_id)
        )
    assert caught.value.details["reason"] == "artifact_identity_mismatch"


def test_performance_take_schema_accepts_score_tempo_selection() -> None:
    request = PerformanceTakeUploadReservationRequest.model_validate(
        _reservation_request_payload(
            {
                "practice_binding": {
                    "score_id": "score-uuid-10",
                    "revision_id": DEFAULT_TAKE_REVISION_ID,
                    "bundle_id": _bundle_id(),
                },
                "media": {
                    "kind": "AUDIO",
                    "byte_size": len(VALID_WEBM_BYTES),
                    "mime_type": "audio/webm",
                },
                "scope": {"kind": "FULL"},
                "client_request_id": "req-product-default-tempo",
                "tempo_selection": {"mode": "SCORE"},
                "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
            }
        )
    )

    assert request.tempo_selection.mode == "SCORE"
