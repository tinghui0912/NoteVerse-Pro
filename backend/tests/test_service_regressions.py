from __future__ import annotations
from tests.support.images import image_bytes

import os
import io
import tempfile
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch, call

import pytest
from PIL import Image

from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.models.user import User
from app.db.models.import_job import ImportJobState
from app.modules.uploads.service import UploadService
import hashlib
from app.modules.account.avatar_service import AvatarService
from app.modules.account.avatar_presentation import avatar_url_for_user
from app.modules.storage_objects.persistence import object_from_bytes
from tests.test_score_revision_services import score_service_session as score_service_session
from app.modules.account.profile_service import ProfileService
from app.modules.import_jobs.pipeline_runner import ImportPipelineRunner
from app.modules.import_jobs.maintenance_service import ImportJobMaintenanceService
from app.modules.import_jobs.submission_service import ImportJobSubmissionService
from app.modules.import_jobs.pipeline.artifact_recorder import _build_file_item
from app.shared.error_codes import CustomerErrorCode
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from tests.support.object_storage import InMemoryObjectStorage
from app.storage.s3_compatible import S3CompatibleObjectStorage
from app.shared.time import utc_now


class FakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put_object(self, *, Bucket, Key, Body, **kwargs):
        self.objects[Key] = Body

    def head_object(self, *, Bucket, Key):
        if Key not in self.objects:
            raise FakeS3NotFound()
        return {"ContentLength": len(self.objects[Key])}

    def delete_object(self, *, Bucket, Key):
        self.objects.pop(Key, None)

    def list_objects_v2(self, *, Bucket, Prefix, MaxKeys):
        keys = [key for key in self.objects if key.startswith(Prefix)]
        contents = [{"Key": key, "Size": len(self.objects[key])} for key in sorted(keys)[:MaxKeys]]
        return {"Contents": contents}

    def download_file(self, bucket, key, target_path):
        if key not in self.objects:
            raise FakeS3NotFound()
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, "wb") as file_handle:
            file_handle.write(self.objects[key])

    def generate_presigned_url(self, ClientMethod, Params, ExpiresIn):
        return f"https://signed.example/{Params['Key']}"


class FakeS3NotFound(Exception):
    response = {"Error": {"Code": "NoSuchKey"}}


def test_object_storage_put_and_materialize() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = InMemoryObjectStorage()
        stored = storage.put_bytes(key="objects/example.bin", content=b"score")

        assert stored.size_bytes == 5
        assert stored.object_key == "objects/example.bin"
        assert storage.materialize_to_local(
            stored.object_key, os.path.join(temp_dir, "scratch.png")
        ) == os.path.join(temp_dir, "scratch.png")


def test_object_storage_delete_is_idempotent() -> None:
    with tempfile.TemporaryDirectory():
        storage = InMemoryObjectStorage()
        stored = storage.put_bytes(key="objects/example.bin", content=b"score")

        assert storage.delete(stored.object_key) is True
        assert storage.delete(stored.object_key) is False


def test_object_storage_rejects_path_traversal_keys() -> None:
    with tempfile.TemporaryDirectory():
        storage = InMemoryObjectStorage()

        with pytest.raises(ValueError):
            storage.put_bytes(key="../escape.txt", content=b"bad")


@pytest.mark.parametrize(
    "kind,extension,content,mime",
    [
        ("preview_image", "svg", b"<svg />", "image/svg+xml"),
        (ImportArtifactKind.REVIEW_MUSICXML, "jpg", b"jpg", "image/jpeg"),
    ],
)
def test_artifact_recorder_persists_intent_before_upload(
    score_service_session, monkeypatch, tmp_path, kind, extension, content, mime
):
    from contextlib import contextmanager
    from app.db.models import ObjectWriteIntent
    from sqlalchemy import select

    db, storage = score_service_session

    @contextmanager
    def session():
        yield db
        db.commit()

    monkeypatch.setattr("app.modules.import_jobs.pipeline.artifact_recorder.SessionLocal", session)
    monkeypatch.setattr(
        "app.modules.import_jobs.pipeline.artifact_recorder.object_storage", storage
    )
    path = tmp_path / f"output.{extension}"
    path.write_bytes(content)
    item = _build_file_item("task-1", kind, str(path), page=1)
    row = db.scalar(select(ObjectWriteIntent))
    assert set(item) == {"write_intent_uuid", "write_token", "filename", "page_number"}
    assert item["write_intent_uuid"] == row.intent_uuid and item["write_token"] == row.write_token
    assert row.status == "WRITTEN" and row.content_type == mime
    assert (
        row.object_key
        == f"jobs/task-1/{getattr(kind, 'value', kind)}/{hashlib.sha256(content).hexdigest()}/001-output.{extension}"
    )
    assert row.byte_size == len(content) and storage.read_bytes(row.object_key) == content


@pytest.mark.parametrize("mode", ("RGB", "RGBA", "L"))
def test_avatar_service_stores_processed_image_through_storage(mode: str) -> None:
    with tempfile.TemporaryDirectory():
        storage = InMemoryObjectStorage()
        service = AvatarService(storage=storage)
        put = Mock(wraps=storage.put_bytes)
        storage.put_bytes = put
        image = Image.new(mode, (400, 100), 128 if mode == "L" else "red")
        image_bytes = io.BytesIO()
        image.save(image_bytes, format="PNG")

        avatar_key, avatar_bytes = service.process_avatar(
            file_bytes=image_bytes.getvalue(),
            filename="avatar.png",
            user_id=7,
        )

        filename = avatar_key.rsplit("/", 1)[-1]
        put.assert_not_called()
        assert filename.startswith("7_")
        assert filename.endswith(".jpg")
        with Image.open(io.BytesIO(avatar_bytes)) as avatar:
            assert avatar.format == "JPEG"
            assert avatar.mode == "RGB"
            assert avatar.size == (200, 200)
            # A wide image is fitted and centered on the white avatar canvas.
            assert avatar.getpixel((100, 50)) == (255, 255, 255)
            assert avatar.getpixel((100, 100)) != (255, 255, 255)
        assert not storage.exists(avatar_key)
        storage.put_bytes(key=avatar_key, content=avatar_bytes, content_type="image/jpeg")
        assert storage.read_bytes(avatar_key) == avatar_bytes
        with patch.object(storage, "delete", wraps=storage.delete) as delete:
            assert storage.delete(f"avatars/{filename}") is True
            delete.assert_called_once_with(f"avatars/{filename}")


def test_profile_payload_does_not_repair_missing_avatar_reference() -> None:
    user = User(
        id=7,
        email="user@example.com",
        display_name="User",
        password_hash="hash",
        avatar_object=object_from_bytes(
            object_key="avatars/profile.jpg", content=b"avatar", content_type="image/jpeg"
        ),
    )

    payload = ProfileService().profile_payload(user)

    assert payload.user.avatar_url == avatar_url_for_user(user)
    assert user.avatar_object.object_key == "avatars/profile.jpg"


def test_avatar_service_replaces_user_avatar_and_queues_old_object(
    score_service_session,
) -> None:
    with tempfile.TemporaryDirectory():
        session, storage = score_service_session
        service = AvatarService(storage=storage)
        storage.put_bytes(key="avatars/old.jpg", content=b"old", content_type="image/jpeg")
        user = User(
            id=7,
            email="user@example.com",
            display_name="User",
            password_hash="hash",
            avatar_object=object_from_bytes(
                object_key="avatars/old.jpg", content=b"old", content_type="image/jpeg"
            ),
        )
        session.add(user)
        session.commit()
        db = session
        image = Image.new("RGB", (20, 20), (255, 0, 0))
        image_bytes = io.BytesIO()
        image.save(image_bytes, format="PNG")

        filename, avatar_url = service.replace_user_avatar(
            db,
            user,
            file_bytes=image_bytes.getvalue(),
            filename="avatar.png",
        )

        assert filename.startswith("7_")
        assert avatar_url_for_user(user) == avatar_url
        assert storage.exists(f"avatars/{filename}")
        assert storage.exists("avatars/old.jpg")
        from tests.support.retirement import drain_retirements

        assert drain_retirements(session, storage)[0]["status"] == "completed"
        assert not storage.exists("avatars/old.jpg")
        assert (
            user.avatar_object.sha256
            == hashlib.sha256(storage.read_bytes(user.avatar_object.object_key)).hexdigest()
        )


def test_s3_storage_put_and_materialize() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = S3CompatibleObjectStorage()
        storage.bucket = "bucket"
        storage.endpoint_url = "https://oss-cn-shenzhen.aliyuncs.com"
        storage._client = FakeS3Client()

        with patch("app.storage.s3_compatible.settings.WORK_ROOT", temp_dir):
            stored = storage.put_bytes(key="objects/example.bin", content=b"score")
            path = storage.materialize_to_local(
                stored.object_key, os.path.join(temp_dir, "scratch.png")
            )

        assert stored.object_key == "objects/example.bin"
        assert os.path.exists(path)
        with open(path, "rb") as file_handle:
            assert file_handle.read() == b"score"


def test_import_job_maintenance_releases_orphan_upload_and_queues_retirement() -> None:
    repository = Mock()
    storage = Mock()
    storage.delete.return_value = True
    service = ImportJobMaintenanceService(repository=repository)
    db = MagicMock()

    upload = SimpleNamespace(
        id=3,
        upload_uuid="upload-orphan",
        stored_object_id=9,
        uploader_user_id=7,
        created_at=utc_now() - timedelta(days=2),
    )
    blob = SimpleNamespace(id=9, byte_size=123, object_key="blobs/or/orphan.png")
    repository.list_orphan_uploads.return_value = [upload]
    db.get.return_value = blob
    db.execute.return_value.scalar_one.return_value = 1

    with (
        patch(
            "app.modules.import_jobs.maintenance_service.settings.ORPHAN_UPLOAD_TTL_SECONDS",
            86400,
        ),
        patch(
            "app.modules.import_jobs.maintenance_service.storage_usage_service.record_release"
        ) as release_usage,
        patch(
            "app.modules.import_jobs.maintenance_service.retire_after_release",
            return_value=["retirement"],
        ) as retire,
    ):
        deleted = service.cleanup_orphan_uploads(db)

    assert deleted == 1
    storage.delete.assert_not_called()
    retire.assert_called_once_with(db, 9)
    release_usage.assert_called_once()
    assert release_usage.call_args.kwargs["user_id"] == 7
    assert release_usage.call_args.kwargs["bytes_count"] == 123
    assert release_usage.call_args.kwargs["storage_key"] == "blobs/or/orphan.png"
    db.delete.assert_any_call(upload)
    assert [call.args[0] for call in db.delete.call_args_list] == [upload]
    db.commit.assert_called_once()


def test_import_job_submission_persists_without_contacting_celery() -> None:
    repository = Mock()
    repository.submission_uploads = Mock(
        return_value=[
            {"id": 3, "upload_uuid": "abc", "uploader_user_id": 5},
        ]
    )
    service = ImportJobSubmissionService(repository=repository)
    request = SimpleNamespace(upload_ids=["abc"], options={}, idempotency_key=None)
    current_user = SimpleNamespace(id=5)
    db = Mock(commit=Mock(), rollback=Mock())

    def flush():
        db.add.call_args_list[0].args[0].id = 10

    db.flush = Mock(side_effect=flush)
    result = service.submit(db, current_user, request)
    assert result["count"] == 1
    assert result["state"] == ImportJobState.QUEUED
    assert result["job_id"] == db.add.call_args_list[0].args[0].job_uuid
    assert len(db.add.call_args_list) == 3
    db.commit.assert_called_once()


def test_import_job_submission_reuses_existing_idempotency_key() -> None:
    repository = Mock()
    repository.get_by_idempotency_key = Mock(return_value=SimpleNamespace(job_uuid="existing-job"))
    repository.submission_uploads = Mock()
    service = ImportJobSubmissionService(repository=repository)
    request = SimpleNamespace(upload_ids=["abc"], options={}, idempotency_key="submission-key-1")
    current_user = SimpleNamespace(id=5)
    db = Mock(commit=Mock())
    result = service.submit(db, current_user, request)
    assert result == {"job_id": "existing-job", "count": 1, "state": ImportJobState.QUEUED}
    repository.get_by_idempotency_key.assert_called_once_with(db, 5, "submission-key-1")
    repository.submission_uploads.assert_not_called()
    db.commit.assert_not_called()


def test_import_job_submission_serializes_genres_for_json_storage() -> None:
    service = ImportJobSubmissionService()

    options = {
        "display_title": "Once Again",
        "genres": [
            "soundtrack",
        ],
    }

    assert service._storage_options(options) == {
        "display_title": "Once Again",
        "genres": ["soundtrack"],
    }


def test_import_worker_materializes_admitted_input_bytes(tmp_path, monkeypatch) -> None:
    from app.modules.storage_objects.reads import StoredObjectReadTarget

    target = StoredObjectReadTarget(1, "blobs/input.png", 5, "image/png")
    destination = tmp_path / "input.png"
    storage = Mock(iter_bytes=Mock(return_value=iter([b"input"])))
    monkeypatch.setattr(
        "app.modules.import_jobs.pipeline_runner.object_work_path", lambda _: str(destination)
    )
    service = ImportPipelineRunner(storage=storage)
    assert service._resolve_input_paths([target]) == [str(destination)]
    assert destination.read_bytes() == b"input"
    storage.iter_bytes.assert_called_once_with(target.storage_key)


def test_import_job_submission_rejects_upload_owned_by_another_user() -> None:
    repository = Mock(
        submission_uploads=Mock(
            return_value=[
                {"id": 3, "upload_uuid": "abc", "uploader_user_id": 99},
            ]
        )
    )
    service = ImportJobSubmissionService(repository=repository)
    db = Mock(rollback=Mock(), commit=Mock())
    with pytest.raises(ResourceNotFoundException) as context:
        service.submit(
            db,
            SimpleNamespace(id=5),
            SimpleNamespace(upload_ids=["abc"], options=None, idempotency_key=None),
        )
    assert context.value.code == CustomerErrorCode.FILE_NOT_FOUND
    db.rollback.assert_called_once()
    db.commit.assert_not_called()


def test_upload_reuses_committed_exact_object_without_rewriting(score_service_session):
    from fastapi import UploadFile
    from sqlalchemy import select
    from app.db.models import Upload

    session, storage = score_service_session
    service = UploadService(storage=storage)
    user = session.get(User, 1)
    service.create_upload(
        session,
        user,
        UploadFile(filename="first.png", file=io.BytesIO(image_bytes())),
    )
    storage.put_bytes = Mock(wraps=storage.put_bytes)
    second = service.create_upload(
        session,
        user,
        UploadFile(filename="second.png", file=io.BytesIO(image_bytes())),
    )
    assert second.byte_size == len(image_bytes()) and storage.put_bytes.call_count == 0
    assert len({row.stored_object_id for row in session.scalars(select(Upload))}) == 1


def test_delete_upload_rejects_non_owner() -> None:
    repository = Mock()
    repository.get_upload_by_uuid = Mock(
        return_value=SimpleNamespace(
            id=1, upload_uuid="upload-1", stored_object_id=5, uploader_user_id=99
        )
    )
    service = UploadService(repository=repository)
    db = Mock()
    current_user = SimpleNamespace(id=1)

    with pytest.raises(UnauthorizedException) as context:
        service.delete_upload(db, current_user, "upload-1")

    assert context.value.code == CustomerErrorCode.NO_DELETE_ACCESS
    db.commit.assert_not_called()


def test_delete_upload_removes_owned_upload_and_reference() -> None:
    repository = Mock()
    repository.get_upload_by_uuid = Mock(
        return_value=SimpleNamespace(
            id=7, upload_uuid="upload-owned", uploader_user_id=1, stored_object_id=5
        )
    )
    repository.upload_reference_count = Mock(return_value=0)
    repository.delete_upload_by_id = Mock()
    service = UploadService(repository=repository)
    db = Mock()
    db.get.return_value = SimpleNamespace(
        id=5,
        byte_size=3,
        object_key="blobs/ow/owned.png",
    )
    current_user = SimpleNamespace(id=1)

    with tempfile.TemporaryDirectory() as temp_dir:
        blob_dir = os.path.join(temp_dir, "blobs", "ow")
        os.makedirs(blob_dir, exist_ok=True)
        file_path = os.path.join(blob_dir, "owned.png")
        with open(file_path, "wb") as file_handle:
            file_handle.write(b"png")

        storage = InMemoryObjectStorage()
        service = UploadService(repository=repository, storage=storage)
        with (
            patch(
                "app.modules.uploads.service.storage_usage_service.record_release"
            ) as release_usage,
            patch(
                "app.modules.uploads.service.retire_after_release", return_value=["retirement"]
            ) as retire,
        ):
            result = service.delete_upload(db, current_user, "upload-owned")

    assert result is None
    repository.delete_upload_by_id.assert_called_once_with(db, 7)
    retire.assert_called_once_with(db, 5)
    release_usage.assert_called_once()
    assert release_usage.call_args.kwargs["object_id"] == "upload-owned"
    db.commit.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["profile", "upload"])
async def test_avatar_response_url_routes_to_current_customer_resolver(
    score_service_session, source
):
    from httpx import ASGITransport, AsyncClient
    from app.api.deps import get_current_user, get_db
    from app.main import create_app
    from app.modules.account.dependencies import get_avatar_service

    session, storage = score_service_session
    db = session
    user = session.get(User, 1)
    service = AvatarService(storage=storage)
    image = io.BytesIO()
    Image.new("RGB", (2, 2), "red").save(image, format="PNG")
    # Establish a real current avatar object, using the same service as HTTP upload.
    service.replace_user_avatar(db, user, file_bytes=image.getvalue(), filename="avatar.png")
    app = create_app()

    def avatar_db():
        yield db

    def current_user():
        return user

    app.dependency_overrides[get_db] = avatar_db
    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_avatar_service] = lambda: service
    capabilities = ["https://objects.example/lease-one", "https://objects.example/lease-two"]
    storage.download_url = Mock(side_effect=[*capabilities, "https://objects.example/after-loss"])
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver", follow_redirects=False
    ) as client:
        if source == "profile":
            response = await client.get("/api/v1/me/profile")
            url = response.json()["user"]["avatar_url"]
        else:
            response = await client.post(
                "/api/v1/me/avatar", files={"file": ("avatar.png", image.getvalue(), "image/png")}
            )
            url = response.json()["avatar_url"]
        assert response.status_code == 200
        assert url.startswith("/") and not url.startswith("//")
        assert url == avatar_url_for_user(user)
        key = user.avatar_object.object_key
        for capability in capabilities:
            redirect = await client.get(url)
            assert redirect.status_code == 307
            assert redirect.content == b""
            assert redirect.headers["location"] == capability
        assert storage.download_url.call_args_list == [call(key, content_type="image/jpeg")] * 2
        storage.delete(key)
        storage.exists = Mock(
            side_effect=AssertionError("Admitted avatar resolution needs no HEAD")
        )
        storage.object_metadata = Mock(
            side_effect=AssertionError("Admitted avatar resolution needs no HEAD")
        )
        assert (await client.get(url)).status_code == 307
        assert user.avatar_object.object_key == key
