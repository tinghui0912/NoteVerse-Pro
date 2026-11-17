"""Committed object facts govern semantic reads independently of physical observations."""

from app.modules.import_jobs.requested_options import encode_requested_options

from app.shared.time import utc_now

from unittest.mock import Mock
from hashlib import sha256

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import Response
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.api.storage_streaming import stream_storage_object
from app.core.exceptions import ExternalServiceException
from app.db.models import ImportArtifact, ImportJob, ScoreRevisionSource, StoredObject
from app.db.models.import_job import ImportJobState
from app.db.models.score import RevisionSourceFormat
from app.db.models.import_job import ImportArtifactKind
from app.modules.import_jobs.review.read_model import ImportReviewReadModel
from app.modules.playback.delivery import PlaybackDeliveryReadModel
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.score_assets.service import ScoreAssetService
from app.modules.scores.service import ScoreService
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.storage_objects.reads import (
    StoredObjectDelivery,
    StoredObjectReadTarget,
    StoredObjectIntegrityError,
    iterate_admitted_bytes,
    read_admitted_bytes,
)
from tests.test_guest_previews import (
    preview_context as preview_context,
    add_page,
    add_audio,
    score_service_session as score_service_session,
)
from tests.support.object_storage import InMemoryObjectStorage


def forbid_observations(storage, monkeypatch):
    def probe(*_args, **_kwargs):
        raise AssertionError("Provider metadata cannot decide admitted asset existence")

    for name in ("exists", "size_bytes", "object_metadata"):
        monkeypatch.setattr(storage, name, probe, raising=False)


@pytest.fixture
def admitted(preview_context, monkeypatch):
    db, storage, score, _, guest = preview_context
    score.guest_preview_enabled = True
    content = b'<score-partwise version="4.0"><part-list/></score-partwise>'
    blob = object_from_bytes(
        object_key="source.xml", content=content, content_type="application/xml"
    )
    storage.put_bytes(key=blob.object_key, content=content)
    source = ScoreRevisionSource(
        source_uuid="source",
        generator="test",
        generator_version="1",
        revision_id=901,
        format=RevisionSourceFormat.MUSICXML,
        filename="source.xml",
        stored_object=blob,
    )
    db.add(source)
    db.commit()
    page = add_page(db, storage, 901, "page-a")
    add_audio(db, storage, 901)
    db.add(
        ImportJob(
            requested_options=encode_requested_options(None),
            processing_started_at=utc_now(),
            processing_finished_at=utc_now(),
            id=80,
            job_uuid="review",
            user_id=1,
            state=ImportJobState.READY_FOR_REVIEW,
        )
    )
    xml = object_from_bytes(
        object_key="review.xml", content=content, content_type="application/xml"
    )
    storage.put_bytes(key=xml.object_key, content=content)
    db.add(
        ImportArtifact(
            job_id=80,
            artifact_uuid="review-xml",
            kind=ImportArtifactKind.REVIEW_MUSICXML,
            filename="review.xml",
            stored_object=xml,
        )
    )
    db.commit()
    forbid_observations(storage, monkeypatch)
    return db, storage, score, source, page, guest


def test_admitted_asset_lists_deliveries_and_review_use_database_facts(admitted):
    db, storage, score, source, page, guest = admitted
    assets = ScoreAssetService(storage=storage)
    listed = assets.list_revision_assets(db, score.score_uuid, 1)
    assert listed.revision_sources[0].source_id == source.source_uuid
    assert listed.render_assets[0].render_asset_id == page.asset_uuid
    assert listed.render_assets[0].render_profile == page.render_profile
    assert set(listed.revision_sources[0].model_dump()) == {
        "source_id",
        "revision_id",
        "format",
        "filename",
        "mime_type",
        "size_bytes",
        "created_at",
    }
    assert set(listed.render_assets[0].model_dump()) == {
        "render_asset_id",
        "render_profile",
        "revision_id",
        "kind",
        "filename",
        "mime_type",
        "size_bytes",
        "page_number",
        "created_at",
    }
    assert (
        assets.source_delivery(db, source.source_uuid, 1).byte_size
        == source.stored_object.byte_size
    )
    assert assets.render_asset_access_url(db, page.asset_uuid, 1).asset_id == page.asset_uuid
    assert assets.source_access_url(db, source.source_uuid, 1).asset_id == source.source_uuid
    preview = guest.read(db, score.guest_preview_token)
    assert [item.asset_id for item in preview.render_assets] == [
        page.asset_uuid
    ] and preview.audio_available
    assert (
        guest.image(db, score.guest_preview_token, page.asset_uuid).byte_size
        == page.stored_object.byte_size
    )
    playback = PlaybackDeliveryReadModel(access_policy=ScoreAccessPolicy()).delivery_for_revision(
        db, 901
    )
    assert playback.byte_size == 12
    assert (
        ImportReviewReadModel(storage)
        .detail(db, "review", 1)
        .musicxml.content.startswith("<score-partwise")
    )

    from app.modules.revisions.service import RevisionService

    assert (
        RevisionService(storage=storage)
        .content(db, score.score_uuid, "revision-a", 1)
        .content.startswith("<score-partwise")
    )


def test_physical_loss_preserves_admitted_assets_and_product_readiness(admitted):
    db, storage, score, source, page, guest = admitted
    storage.objects.clear()
    listed = ScoreAssetService(storage=storage).list_revision_assets(db, score.score_uuid, 1)
    assert len(listed.revision_sources) == len(listed.render_assets) == 1
    preview = guest.read(db, score.guest_preview_token)
    assert len(preview.render_assets) == 1 and preview.audio_available
    state = ScoreService(storage=storage).get(db, score.score_uuid, 1).derived_assets
    assert state.preview.status == state.audio.status == "ready"
    before = db.scalar(select(func.count()).select_from(StoredObject))
    with pytest.raises(StoredObjectIntegrityError):
        read_admitted_bytes(storage, StoredObjectReadTarget.from_object(source.stored_object))
    with pytest.raises(StoredObjectIntegrityError):
        ImportReviewReadModel(storage).detail(db, "review", 1)
    assert db.scalar(select(func.count()).select_from(StoredObject)) == before
    assert db.get(ScoreRevisionSource, source.id) is source


@pytest.mark.parametrize(
    "header,status,body,content_range",
    [
        (None, 200, b"0123456789", None),
        ("bytes=2-5", 206, b"2345", "bytes 2-5/10"),
        ("bytes=-3", 206, b"789", "bytes 7-9/10"),
        ("bytes=8-", 206, b"89", "bytes 8-9/10"),
        ("bytes=10-", 416, b"", "bytes */10"),
    ],
)
def test_stream_headers_and_ranges_use_persisted_size(
    monkeypatch, header, status, body, content_range
):
    storage = InMemoryObjectStorage()
    storage.put_bytes(key="media", content=b"0123456789")
    forbid_observations(storage, monkeypatch)
    target = StoredObjectDelivery(1, "media", 10, "audio/wav", "recording.wav")
    app = FastAPI()

    @app.get("/media")
    def stream(request: Request):
        return stream_storage_object(
            storage=storage,
            target=target,
            attachment=False,
            request=request,
            enable_range=True,
            chunk_size=3,
        )

    with TestClient(app) as client:
        response = client.get("/media", headers={"range": header} if header else {})
    assert response.status_code == status and response.content == body
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers.get("content-range") == content_range
    if status != 416:
        assert int(response.headers["content-length"]) == len(body)


@pytest.mark.parametrize(
    "error,status,code",
    [
        (FileNotFoundError("private-provider-key"), 500, "internal_error"),
        (TimeoutError("private-provider-network"), 503, "storage_backend_unavailable"),
    ],
)
def test_admitted_read_failures_have_safe_http_and_internal_diagnostics(
    monkeypatch, error, status, code
):
    from app.main import create_app
    from app.modules.storage_objects import reads

    storage = Mock(read_bytes=Mock(side_effect=error))
    target = StoredObjectReadTarget(7, "private-key", 10, "application/xml")
    log = Mock()
    monkeypatch.setattr(reads, "logger", log)
    app = create_app()

    @app.get("/admitted-read")
    def read():
        return Response(read_admitted_bytes(storage, target))

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/admitted-read")
    assert response.status_code == status and response.json()["code"] == code
    assert set(response.json()) == {"code", "request_id"}
    assert "private" not in response.text
    fields = log.bind.call_args.kwargs
    assert (
        fields["stored_object_id"] == 7
        and fields["object_locator_hash"] == sha256(b"private-key").hexdigest()
    )
    from app.core.logger import StructuredLogFieldPolicy

    assert StructuredLogFieldPolicy.filter_extra(fields) == fields
    assert fields["read_operation"] == "read_bytes"
    assert fields["read_failure_classification"] == (
        "integrity" if status == 500 else "availability"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,expected",
    [
        (FileNotFoundError("private"), StoredObjectIntegrityError),
        (TimeoutError("private"), ExternalServiceException),
    ],
)
async def test_inflight_stream_failures_terminate_without_a_fallback(error, expected):
    storage = Mock()

    def chunks(*args, **kwargs):
        yield b"first"
        raise error

    storage.iter_bytes.side_effect = chunks
    stream = iterate_admitted_bytes(
        storage, StoredObjectReadTarget(1, "media", 10, "audio/wav"), chunk_size=5
    )
    assert await anext(stream) == b"first"
    with pytest.raises(expected):
        await anext(stream)


@pytest.mark.parametrize(
    "code,expected",
    [("NoSuchKey", StoredObjectIntegrityError), ("SlowDown", ExternalServiceException)],
)
def test_provider_get_failures_are_classified_without_preflight(code, expected):
    from botocore.exceptions import ClientError
    from app.storage.s3_compatible import S3CompatibleObjectStorage

    storage = S3CompatibleObjectStorage()
    storage._client = Mock()
    storage.client.get_object.side_effect = ClientError(
        {"Error": {"Code": code, "Message": "private-provider-detail"}}, "GetObject"
    )
    with pytest.raises(expected):
        read_admitted_bytes(storage, StoredObjectReadTarget(1, "key", 10, "application/xml"))
    storage.client.get_object.assert_called_once()
    storage.client.head_object.assert_not_called()


def test_worker_time_limit_propagates_as_execution_control():
    from celery.exceptions import SoftTimeLimitExceeded

    error = SoftTimeLimitExceeded()
    storage = Mock(read_bytes=Mock(side_effect=error))
    with pytest.raises(SoftTimeLimitExceeded) as raised:
        read_admitted_bytes(storage, StoredObjectReadTarget(1, "key", 10, "application/xml"))
    assert raised.value is error
