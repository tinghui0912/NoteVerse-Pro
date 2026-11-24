"""Content-verified Upload facts and bounded admission before durable prewrite."""

from uuid import uuid4

import asyncio
import io
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import UploadFile
from sqlalchemy import select
from starlette.datastructures import Headers

from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.models import ObjectWriteIntent, StoredObject, StorageQuotaHold, Upload, User
from app.modules.uploads.service import UploadService
from app.modules.uploads.repository import UploadRepository
from app.modules.uploads.upload_admission import (
    MAX_SCORE_IMPORT_UPLOAD_BYTES,
    admit_score_import_image,
    read_score_import_upload,
)
from app.storage import AsyncObjectStorage
from tests.support.images import image_bytes
from tests.support.object_storage import InMemoryObjectStorage
from tests.test_score_revision_services import score_service_session as score_service_session


def test_upload_delete_identifies_the_missing_resource():
    repository = Mock(spec=UploadRepository)
    repository.get_upload_by_uuid.return_value = None
    db = Mock()

    with pytest.raises(ResourceNotFoundException) as failure:
        UploadService(repository=repository).delete_upload(
            db, SimpleNamespace(id=1), "upload-missing"
        )

    assert failure.value.code == "resource_not_found"
    assert failure.value.details == {
        "resource_type": "upload",
        "resource_id": "upload-missing",
    }
    repository.delete_upload_by_id.assert_not_called()
    db.commit.assert_not_called()


def test_upload_delete_requires_its_persisted_stored_object():
    repository = Mock(spec=UploadRepository)
    repository.get_upload_by_uuid.return_value = SimpleNamespace(
        id=11, uploader_user_id=1, stored_object_id=7
    )
    repository.upload_reference_count.return_value = 0
    db = Mock()
    db.get.return_value = None

    with pytest.raises(RuntimeError, match="Upload is missing its required stored object"):
        UploadService(repository=repository).delete_upload(
            db, SimpleNamespace(id=1), "upload-present"
        )

    db.get.assert_called_once_with(StoredObject, 7)
    repository.delete_upload_by_id.assert_not_called()
    db.commit.assert_not_called()


@pytest.mark.parametrize(
    "container,suffix,mime,canonical",
    [
        ("PNG", "png", "image/png", "png"),
        ("JPEG", "jpg", "image/jpeg", "jpg"),
        ("JPEG", "jpeg", "image/jpeg", "jpg"),
        ("BMP", "bmp", "image/bmp", "bmp"),
        ("GIF", "gif", "image/gif", "gif"),
        ("WEBP", "webp", "image/webp", "webp"),
        ("TIFF", "tif", "image/tiff", "tiff"),
        ("TIFF", "tiff", "image/tiff", "tiff"),
    ],
)
def test_upload_records_detected_container_facts(
    score_service_session, container, suffix, mime, canonical
):
    db, storage = score_service_session
    content = image_bytes(container)
    filename = f"original.{suffix}"
    result = UploadService(storage=storage).create_upload(
        db,
        db.get(User, 1),
        UploadFile(
            filename=filename,
            file=io.BytesIO(content),
            headers=Headers({"content-type": "text/plain"}),
        ),
        client_request_id=uuid4().hex,
    )
    upload = db.scalar(select(Upload))
    obj = db.scalar(select(StoredObject))
    intent = db.scalar(select(ObjectWriteIntent))
    assert upload.original_filename == result.original_filename == filename
    assert obj.content_type == intent.content_type == mime
    assert obj.object_key == intent.object_key and obj.object_key.endswith(f".{canonical}")
    assert storage.read_bytes(obj.object_key) == content


@pytest.mark.parametrize(
    "content,filename",
    [
        (b"", "empty.png"),
        (b"not an image", "fake.png"),
        (image_bytes()[:35], "corrupt.png"),
        (image_bytes("PNG"), "score.jpg"),
        (image_bytes("JPEG"), "score.png"),
        (b"%PDF-1.7", "score.pdf"),
    ],
)
def test_invalid_images_have_no_durable_admission(score_service_session, content, filename):
    db, storage = score_service_session
    with pytest.raises(ValidationException):
        UploadService(storage=storage).create_upload(
            db,
            db.get(User, 1),
            UploadFile(filename=filename, file=io.BytesIO(content)),
            client_request_id=uuid4().hex,
        )
    for model in (Upload, ObjectWriteIntent, StorageQuotaHold):
        assert db.scalar(select(model)) is None
    assert not storage.objects


def test_bounded_reader_accepts_exact_limit_and_reads_only_limit_plus_one():
    from unittest.mock import Mock

    exact = image_bytes()
    exact += b"\0" * (MAX_SCORE_IMPORT_UPLOAD_BYTES - len(exact))
    reader = Mock(return_value=exact)
    content = read_score_import_upload(SimpleNamespace(file=SimpleNamespace(read=reader)))
    assert admit_score_import_image(content, "score.png").container == "PNG"
    reader.assert_called_once_with(MAX_SCORE_IMPORT_UPLOAD_BYTES + 1)


def test_oversize_is_rejected_before_quota_or_object_prewrite(score_service_session):
    db, storage = score_service_session
    with pytest.raises(ValidationException):
        UploadService(storage=storage).create_upload(
            db,
            db.get(User, 1),
            UploadFile(
                filename="large.png", file=io.BytesIO(b"x" * (MAX_SCORE_IMPORT_UPLOAD_BYTES + 1))
            ),
            client_request_id=uuid4().hex,
        )
    for model in (Upload, ObjectWriteIntent, StorageQuotaHold):
        assert db.scalar(select(model)) is None
    assert not storage.objects


@pytest.mark.parametrize("mime", ["text/plain", "image/jpeg", "application/octet-stream"])
def test_client_mime_cannot_override_detected_png(score_service_session, mime):
    db, storage = score_service_session
    UploadService(storage=storage).create_upload(
        db,
        db.get(User, 1),
        UploadFile(
            filename="score.png",
            file=io.BytesIO(image_bytes()),
            headers=Headers({"content-type": mime}),
        ),
        client_request_id=uuid4().hex,
    )
    assert db.scalar(select(StoredObject)).content_type == "image/png"


def test_jpeg_aliases_share_one_physical_object_and_preserve_names(score_service_session):
    db, storage = score_service_session
    storage.put_bytes = Mock(wraps=storage.put_bytes)
    service = UploadService(storage=storage)
    for name in ("first.jpg", "second.jpeg"):
        service.create_upload(
            db,
            db.get(User, 1),
            UploadFile(filename=name, file=io.BytesIO(image_bytes("JPEG"))),
            client_request_id=uuid4().hex,
        )
    uploads = list(db.scalars(select(Upload).order_by(Upload.id)))
    assert [row.original_filename for row in uploads] == ["first.jpg", "second.jpeg"]
    assert uploads[0].stored_object_id == uploads[1].stored_object_id
    assert len(list(db.scalars(select(StoredObject)))) == 1
    assert storage.put_bytes.call_count == 1
    assert uploads[0].stored_object.object_key.endswith(".jpg")


def test_http_upload_and_delivery_schedule_provider_io_off_event_loop(score_service_session):
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session
    from app.main import create_app
    from app.api.deps import get_db, get_current_user
    from app.modules.uploads.dependencies import get_upload_service
    from app.api.storage_streaming import stream_storage_object
    from app.modules.storage_objects.reads import StoredObjectDelivery

    db, storage = score_service_session
    bind = db.get_bind()
    caller_thread = threading.get_ident()
    called = []
    for name in ("put_bytes", "read_bytes", "download_url", "iter_bytes"):
        original = getattr(storage, name)

        def observe(*args, _method=original, _name=name, **kwargs):
            called.append((_name, threading.get_ident()))
            return _method(*args, **kwargs)

        setattr(storage, name, observe)
    service = UploadService(storage=storage)
    application = create_app()

    def database():
        with Session(bind) as request_db:
            yield request_db

    application.dependency_overrides[get_db] = database
    application.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    application.dependency_overrides[get_upload_service] = lambda: service
    key = []

    @application.get("/delivery")
    def delivery():
        assert storage.read_bytes(key[0]) == image_bytes()
        assert storage.download_url(key[0])
        return stream_storage_object(
            storage=storage,
            target=StoredObjectDelivery.for_object(db.scalar(select(StoredObject)), "score.png"),
            attachment=False,
        )

    with TestClient(application) as client:
        response = client.post(
            "/api/v1/uploads",
            data={"client_request_id": uuid4().hex},
            files={"file": ("score.png", image_bytes(), "image/png")},
        )
        assert response.status_code == 200
        key.append(db.scalar(select(StoredObject)).object_key)
        response = client.get("/delivery")
        assert response.status_code == 200 and response.content == image_bytes()
    assert {name for name, _ in called} == {
        "put_bytes",
        "read_bytes",
        "download_url",
        "iter_bytes",
    }
    assert all(thread != caller_thread for _, thread in called)


@pytest.mark.asyncio
async def test_adapter_cancellation_waits_for_physical_mutation_to_settle():
    storage = InMemoryObjectStorage()
    entered, release = threading.Event(), threading.Event()
    original = storage.put_bytes

    def put(**kwargs):
        entered.set()
        assert release.wait(10)
        return original(**kwargs)

    storage.put_bytes = put
    task = asyncio.create_task(
        AsyncObjectStorage(storage).put_bytes(key="cancelled", content=b"bytes")
    )
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert storage.read_bytes("cancelled") == b"bytes"
