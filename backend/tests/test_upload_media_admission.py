"""Content-verified Upload facts and bounded admission before durable prewrite."""

from tests.support.runtime_resources import resources_for

from tests.support.uploads import complete_image_upload


from app.composition import storage_resources as _resource_wiring

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
from app.db.models import ObjectWriteIntent, StoredObject, Upload, User
from app.modules.uploads.service import UploadService
from app.modules.uploads.repository import UploadRepository
from app.storage import AsyncObjectReader
from tests.support.images import image_bytes
from tests.support.object_storage import InMemoryObjectStorage
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.support.runtime_resources import storage as _storage_provider


def test_upload_delete_identifies_the_missing_resource():
    repository = Mock(spec=UploadRepository)
    repository.get_upload_by_uuid.return_value = None
    db = Mock()

    with pytest.raises(ResourceNotFoundException) as failure:
        UploadService(
            repository=repository,
            quota=_resource_wiring.storage_quota_service,
            usage=_resource_wiring.storage_usage_service,
            uploads=resources_for(_storage_provider).build_upload_session_service(),
        ).delete_upload(db, SimpleNamespace(id=1), "upload-missing")

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
        UploadService(
            repository=repository,
            quota=_resource_wiring.storage_quota_service,
            usage=_resource_wiring.storage_usage_service,
            uploads=resources_for(_storage_provider).build_upload_session_service(),
        ).delete_upload(db, SimpleNamespace(id=1), "upload-present")

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
    result = complete_image_upload(
        UploadService(
            quota=_resource_wiring.storage_quota_service,
            usage=_resource_wiring.storage_usage_service,
            uploads=resources_for(storage).build_upload_session_service(),
        ),
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
def test_invalid_images_do_not_create_semantic_resources(score_service_session, content, filename):
    from pydantic import ValidationError
    from app.modules.media_storage.upload_sessions.schemas import UploadCreateRequest
    from app.storage.base import DirectUploadTarget
    from app.db.models import StoredObject

    db, storage = score_service_session
    service = UploadService(
        quota=_resource_wiring.storage_quota_service,
        usage=_resource_wiring.storage_usage_service,
        uploads=resources_for(storage).build_upload_session_service(),
    )
    mime = (
        "image/jpeg"
        if filename.endswith("jpg")
        else "image/png"
        if filename.endswith("png")
        else "application/pdf"
    )
    if not content or mime == "application/pdf":
        with pytest.raises((ValidationException, ValidationError)):
            service.create_request(
                db,
                1,
                UploadCreateRequest(
                    client_request_id="invalid",
                    filename=filename,
                    byte_size=len(content),
                    content_type=mime,
                ),
            )
        db.rollback()
    else:
        admission = service.create_request(
            db,
            1,
            UploadCreateRequest(
                client_request_id="invalid",
                filename=filename,
                byte_size=len(content),
                content_type=mime,
            ),
        )
        target = admission.upload_session.upload_target
        storage.receive_upload(
            DirectUploadTarget(target.url, target.method, target.headers), content
        )
        service.uploads.complete(admission.upload_session.session_id, 1)
        with pytest.raises(ValidationException):
            service.finalize_upload(db, 1, admission.upload_session.session_id)
        db.rollback()
        service.cancel_request(db, 1, admission.upload_session.session_id)
        db.commit()
    assert db.scalar(select(Upload)) is None
    assert db.scalar(select(StoredObject)) is None
    assert db.scalar(select(ObjectWriteIntent)) is None


@pytest.mark.parametrize("mime", ["text/plain", "image/jpeg", "application/octet-stream"])
def test_declared_mime_must_match_image_admission(score_service_session, mime):
    from app.modules.media_storage.upload_sessions.schemas import UploadCreateRequest

    db, storage = score_service_session
    service = UploadService(
        quota=_resource_wiring.storage_quota_service,
        usage=_resource_wiring.storage_usage_service,
        uploads=resources_for(storage).build_upload_session_service(),
    )
    with pytest.raises(ValidationException):
        service.create_request(
            db,
            1,
            UploadCreateRequest(
                client_request_id="mismatch",
                filename="input.png",
                byte_size=len(image_bytes()),
                content_type=mime,
            ),
        )
    db.rollback()
    assert db.scalar(select(Upload)) is None
    assert not storage.objects


@pytest.mark.asyncio
async def test_reader_cancellation_waits_for_stream_read_and_closes_iterator():
    entered, release = threading.Event(), threading.Event()
    closed = threading.Event()
    storage = InMemoryObjectStorage()

    def iterate(*args, **kwargs):
        try:
            entered.set()
            assert release.wait(10)
            yield b"bytes"
        finally:
            closed.set()

    storage.iter_bytes = iterate
    stream = AsyncObjectReader(storage).iter_bytes("read")
    task = asyncio.create_task(anext(stream))
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()
