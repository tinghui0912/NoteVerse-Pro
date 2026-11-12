"""Capture containers remain raw through reservation, verification and Take delivery."""

from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ValidationException
from app.db.models import PerformanceTake, PerformanceTakeManifest
from app.main import app
from app.modules.performance_takes.dependencies import (
    get_performance_take_service,
    get_performance_take_upload_service,
)
from app.modules.storage_usage.service import StorageUsageService
from app.modules.storage_usage.dependencies import get_storage_usage_service
from app.storage.factory import get_object_storage
from app.storage.base import ObjectMetadata
from tests.test_performance_takes import (
    AsyncSessionAdapter,
    PerformanceTakeTestClient,
    _performance_take_service,
    _bundle_id,
    _run_async,
    _staging_key,
    test_env as test_env,
)

MP4_BYTES = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42" + b"raw-capture"
WEBM_BYTES = b"\x1a\x45\xdf\xa3" + b"raw-capture"


@pytest.fixture
def recording_client(test_env):
    session, storage, user, _ = test_env
    usage = StorageUsageService()
    service = _performance_take_service(
        session=session, storage=storage, storage_usage_service=usage
    )

    async def db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides.update(
        {
            get_db: db,
            get_current_user: lambda: user,
            get_object_storage: lambda: storage,
            get_storage_usage_service: lambda: usage,
            get_performance_take_service: lambda: service.takes,
            get_performance_take_upload_service: lambda: service,
        }
    )
    try:
        yield PerformanceTakeTestClient(app), session, storage, service
    finally:
        app.dependency_overrides.clear()


def reserve(client, kind, mime, size):
    return client.post(
        "/api/v1/performance-takes/upload-reservations",
        json={
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": "revision-uuid-100",
                "bundle_id": _bundle_id(),
            },
            "media": {"kind": kind, "mime_type": mime, "byte_size": size},
            "scope": {"kind": "FULL"},
            "client_request_id": "capture-recording",
        },
    )


@pytest.mark.parametrize(
    ("kind", "mime", "accepted"),
    [
        ("VIDEO", "video/webm", True),
        ("VIDEO", "video/mp4", True),
        ("VIDEO", " VIDEO/MP4 ;codecs=avc1", True),
        ("VIDEO", "audio/mp4", False),
        ("AUDIO", "video/mp4", False),
        ("VIDEO", "video/quicktime", False),
        *[
            ("AUDIO", mime, True)
            for mime in ("audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-wav")
        ],
    ],
)
def test_recording_admission_preserves_capture_container_kind(
    recording_client, kind, mime, accepted
):
    client, _, _, _ = recording_client
    response = reserve(client, kind, mime, 32)
    assert response.status_code == (200 if accepted else 422), response.text
    if accepted:
        assert (
            response.json()["data"]["manifest"]["capture"]["mime_type"]
            == mime.split(";")[0].strip().lower()
        )


@pytest.mark.parametrize(
    ("mime", "content", "extension"),
    [
        ("video/mp4", MP4_BYTES, "mp4"),
        ("video/webm", WEBM_BYTES, "webm"),
    ],
)
def test_video_recording_and_delivery_preserve_exact_raw_capture(
    recording_client, mime, content, extension
):
    client, session, storage, service = recording_client
    reserved = reserve(client, "VIDEO", mime + ";codecs=browser-selected", len(content))
    assert reserved.status_code == 200, reserved.text
    data = reserved.json()["data"]
    key = _staging_key(session, data["reservation_id"])
    assert key.endswith("." + extension)
    storage.put_bytes(key=key, content=content, content_type=mime)
    finalized = client.post(
        f"/api/v1/performance-takes/upload-reservations/{data['reservation_id']}/finalize"
    )
    assert finalized.status_code == 200, finalized.text
    take = finalized.json()["data"]
    assert (
        take["manifest"]["capture"]["kind"],
        take["recording_media"]["mime_type"],
        take["recording_media"]["byte_size"],
    ) == (
        "VIDEO",
        mime,
        len(content),
    )
    row = session.execute(
        select(PerformanceTake)
        .join(PerformanceTakeManifest)
        .where(PerformanceTakeManifest.take_uuid == take["take_id"])
    ).scalar_one()
    assert row.recording_object.object_key.endswith("." + extension)
    assert b"".join(storage.iter_bytes(row.recording_object.object_key)) == content
    playback = client.get(f"/api/v1/performance-takes/{take['take_id']}/playback-url")
    assert playback.status_code == 200, playback.text
    assert set(playback.json()["data"]) == {"take_id", "playback_url", "download_url", "expires_in"}
    assert playback.json()["data"]["download_url"]
    media = client.get(f"/api/v1/performance-takes/{take['take_id']}/media")
    assert media.status_code == 200, media.text
    assert media.headers["content-type"] == mime
    assert f".{extension}" in media.headers["content-disposition"]
    assert media.content == content
    replay = client.post(
        f"/api/v1/performance-takes/upload-reservations/{data['reservation_id']}/finalize"
    )
    assert replay.status_code == 200
    assert replay.json()["data"]["take_id"] == take["take_id"]


@pytest.mark.parametrize(
    ("mime", "stored_mime", "content"),
    [
        ("video/mp4", "video/mp4", b"ftyp-in-the-wrong-position"),
        ("video/mp4", "video/webm", MP4_BYTES),
        ("video/webm", "video/mp4", WEBM_BYTES),
        ("video/webm", "video/webm", MP4_BYTES),
    ],
)
@pytest.mark.parametrize("boundary", ["HTTP", "SERVICE"])
def test_video_finalize_rejects_wrong_container_or_storage_content_type(
    recording_client, mime, stored_mime, content, boundary
):
    client, session, storage, service = recording_client
    data = reserve(client, "VIDEO", mime, len(content)).json()["data"]
    storage.put_bytes(
        key=_staging_key(session, data["reservation_id"]), content=content, content_type=stored_mime
    )
    # The storage double supplies the metadata that an object-store HEAD returns.
    with patch.object(
        storage,
        "object_metadata",
        return_value=ObjectMetadata(
            size_bytes=len(content),
            content_type=stored_mime,
        ),
    ):
        if boundary == "HTTP":
            response = client.post(
                f"/api/v1/performance-takes/upload-reservations/{data['reservation_id']}/finalize"
            )
            assert response.status_code == 422, response.text
            assert response.json()["public_code"] == "validation_error"
        else:
            with pytest.raises(ValidationException) as caught:
                _run_async(
                    service.finalize_take(AsyncSessionAdapter(session), 1, data["reservation_id"])
                )
            assert caught.value.details["field"] == "media_mime_type"
    assert session.execute(select(PerformanceTake)).scalars().all() == []
