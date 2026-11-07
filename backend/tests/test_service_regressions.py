from __future__ import annotations

import os
import io
import tempfile
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock, patch, call

import pytest
from PIL import Image

from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.models.user import User
from app.db.models.import_job import ImportJobState
from app.modules.files.service import FilesService, blob_object_key
from app.storage import ObjectWriteResult
import hashlib
from app.modules.account.avatar_service import AvatarService
from app.modules.account.avatar_presentation import avatar_url_for_user
from app.modules.storage_objects.persistence import object_from_bytes
from tests.test_score_revision_services import AsyncSessionAdapter
from tests.test_score_revision_services import score_service_session as score_service_session
from app.modules.account.profile_service import ProfileService
from app.modules.import_jobs.execution_service import ImportJobExecutionService
from app.modules.import_jobs.maintenance_service import ImportJobMaintenanceService
from app.modules.import_jobs.worker_service import sync_import_job_service
from app.modules.import_jobs.submission_service import ImportJobSubmissionService
from app.modules.scores.schemas import ScoreTaxonomyTagInput
from app.pipeline.files_recorder import _build_file_item
from app.shared.constants import ErrorCode
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from tests.support.object_storage import InMemoryObjectStorage
from app.storage.s3_compatible import S3CompatibleObjectStorage
from app.storage.paths import object_work_path
from app.utils.timezone import utc_now_naive


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


def test_allowed_file_accepts_supported_extensions() -> None:
    service = FilesService(repository=Mock())

    assert service.allowed_file("score.png") is True
    assert service.allowed_file("score.TIFF") is True
    assert service.allowed_file("score.pdf") is False
    assert service.allowed_file("score") is False


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


def test_files_recorder_uploads_task_output_to_storage_key() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = InMemoryObjectStorage()
        output_path = os.path.join(temp_dir, "preview-01.svg")
        with open(output_path, "w", encoding="utf-8") as file_handle:
            file_handle.write("<svg />")

        with patch("app.pipeline.files_recorder.object_storage", storage):
            item = _build_file_item(
                "task-1",
                "preview_image",
                output_path,
                page=1,
            )

        assert (
            item["storage_key"] == f"jobs/task-1/preview_image/{item['sha256']}/001-preview-01.svg"
        )
        assert item["filename"] == "001-preview-01.svg"
        assert item["page_number"] == 1
        assert item["mime_type"] == "image/svg+xml"
        assert item["size"] == 7
        assert storage.exists(item["storage_key"])


def test_files_recorder_uses_file_kind_values_in_storage_keys() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = InMemoryObjectStorage()
        output_path = os.path.join(temp_dir, "input.jpg")
        with open(output_path, "wb") as file_handle:
            file_handle.write(b"jpg")

        with patch("app.pipeline.files_recorder.object_storage", storage):
            item = _build_file_item(
                "task-1",
                ImportArtifactKind.REVIEW_MUSICXML,
                output_path,
                page=1,
            )

        assert item["storage_key"] == f"jobs/task-1/review_musicxml/{item['sha256']}/001-input.jpg"
        assert "ImportArtifactKind" not in item["storage_key"]


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

        avatar_object = service.process_avatar(
            file_bytes=image_bytes.getvalue(),
            filename="avatar.png",
            user_id=7,
        )

        filename = avatar_object.object_key.rsplit("/", 1)[-1]
        avatar_url = avatar_url_for_user(User(avatar_object=avatar_object))
        put.assert_called_once()
        assert put.call_args.kwargs["key"] == f"avatars/{filename}"
        assert put.call_args.kwargs["content_type"] == "image/jpeg"
        assert filename.startswith("7_")
        assert filename.endswith(".jpg")
        assert avatar_url == f"/api/v1/account/avatars/{filename}"
        with Image.open(io.BytesIO(storage.read_bytes(f"avatars/{filename}"))) as avatar:
            assert avatar.format == "JPEG"
            assert avatar.mode == "RGB"
            assert avatar.size == (200, 200)
            # A wide image is fitted and centered on the white avatar canvas.
            assert avatar.getpixel((100, 50)) == (255, 255, 255)
            assert avatar.getpixel((100, 100)) != (255, 255, 255)
        with patch.object(storage, "exists", wraps=storage.exists) as exists:
            assert service.avatar_exists(filename)
            exists.assert_called_once_with(f"avatars/{filename}")
        with patch.object(storage, "delete", wraps=storage.delete) as delete:
            assert storage.delete(f"avatars/{filename}") is True
            delete.assert_called_once_with(f"avatars/{filename}")


def test_avatar_service_detects_missing_local_avatar() -> None:
    with tempfile.TemporaryDirectory():
        storage = InMemoryObjectStorage()
        service = AvatarService(storage=storage)

        assert service.avatar_exists("missing.jpg") is False


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

    assert payload.user.avatar_url == "/api/v1/account/avatars/profile.jpg"
    assert user.avatar_object.object_key == "avatars/profile.jpg"


@pytest.mark.asyncio
async def test_avatar_service_replaces_user_avatar_and_queues_old_object(
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
        db = AsyncSessionAdapter(session)
        image = Image.new("RGB", (20, 20), (255, 0, 0))
        image_bytes = io.BytesIO()
        image.save(image_bytes, format="PNG")

        filename, avatar_url = await service.replace_user_avatar(
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
        created_at=utc_now_naive() - timedelta(days=2),
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
            "app.modules.import_jobs.maintenance_service.storage_usage_service.record_release_sync"
        ) as release_usage,
        patch(
            "app.modules.import_jobs.maintenance_service.retire_released_objects",
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


@pytest.mark.asyncio
async def test_import_job_submission_persists_without_contacting_celery() -> None:
    service = ImportJobSubmissionService()
    request = SimpleNamespace(file_ids=["abc"], options={}, idempotency_key=None)
    current_user = SimpleNamespace(id=5)

    with patch.object(service, "_ensure_uploads_exist") as ensure_mock:
        with patch.object(service, "_create_pending_job") as create_mock:
            result = await service.submit(current_user, request)

    ensure_mock.assert_called_once_with(5, ["abc"])
    create_mock.assert_called_once()
    assert result["count"] == 1
    assert result["state"] == ImportJobState.PENDING
    assert result["job_id"] == create_mock.call_args.args[0]


@pytest.mark.asyncio
async def test_import_job_submission_reuses_existing_idempotency_key() -> None:
    service = ImportJobSubmissionService()
    request = SimpleNamespace(
        file_ids=["abc"],
        options={},
        idempotency_key="submission-key-1",
    )
    current_user = SimpleNamespace(id=5)

    with patch.object(
        service,
        "_existing_job_uuid",
        return_value="existing-job",
    ) as existing_mock:
        with patch.object(service, "_ensure_uploads_exist") as ensure_mock:
            result = await service.submit(current_user, request)

    assert result == {
        "job_id": "existing-job",
        "count": 1,
        "state": ImportJobState.PENDING,
    }
    existing_mock.assert_called_once_with(5, "submission-key-1")
    ensure_mock.assert_not_called()


def test_import_job_submission_serializes_taxonomy_tags_for_json_storage() -> None:
    service = ImportJobSubmissionService()

    options = {
        "title": "Once Again",
        "taxonomy_tags": [
            ScoreTaxonomyTagInput(category="genre", code="soundtrack"),
        ],
    }

    assert service._storage_options(options) == {
        "title": "Once Again",
        "taxonomy_tags": [{"category": "genre", "code": "soundtrack"}],
    }


def test_import_job_execution_resolves_file_ids_inside_worker() -> None:
    storage = Mock()
    storage.materialize_to_local.return_value = "C:/worker/cache/score.png"
    service = ImportJobExecutionService(storage=storage)

    assert service._resolve_input_paths(["blobs/ab/abc123.png"]) == ["C:/worker/cache/score.png"]
    storage.materialize_to_local.assert_called_once_with(
        "blobs/ab/abc123.png",
        object_work_path("blobs/ab/abc123.png"),
    )


def test_import_job_submission_rejects_upload_owned_by_another_user() -> None:
    service = ImportJobSubmissionService(storage=Mock())
    sync_db = Mock()
    upload = SimpleNamespace(uploader_user_id=99, stored_object_id=3)
    sync_db.get.return_value = SimpleNamespace(storage_key="blobs/ab/abc123.png")

    with patch("app.db.sync_session.get_db_session", return_value=sync_db):
        with patch.object(
            sync_import_job_service.repository, "get_upload_by_uuid", return_value=upload
        ):
            with pytest.raises(ResourceNotFoundException) as context:
                service._ensure_uploads_exist(5, ["abc"])

    assert context.value.code == ErrorCode.FILE_NOT_FOUND
    sync_db.close.assert_called_once()


@pytest.mark.asyncio
async def test_file_upload_restores_missing_immutable_object() -> None:
    key = blob_object_key(hashlib.sha256(b"score").hexdigest(), ".png")
    existing = object_from_bytes(object_key=key, content=b"score", content_type="image/png")
    existing.id = 3
    before = existing.model_dump()
    repository = Mock()
    repository.get_upload_object_by_sha256 = AsyncMock(return_value=existing)
    repository.create_upload = AsyncMock(return_value=SimpleNamespace(upload_uuid="upload-1"))
    storage = Mock()
    storage.exists.return_value = False
    storage.put_bytes.return_value = ObjectWriteResult(object_key=key, size_bytes=5)
    db = AsyncMock()
    db.run_sync.side_effect = lambda fn: fn(Mock())
    user = SimpleNamespace(id=1)
    upload = SimpleNamespace(
        filename="score.png", content_type="image/png", read=AsyncMock(return_value=b"score")
    )
    with (
        patch("app.modules.files.service.retain_for_reference", return_value=existing) as retain,
        patch("app.modules.files.service.storage_usage_service.reserve") as reserve,
        patch("app.modules.files.service.storage_usage_service.commit_reservation") as commit,
    ):
        reserve.return_value = SimpleNamespace(reservation_id="reservation-1")
        result = await FilesService(repository=repository, storage=storage).upload_file(
            db, user, upload
        )
    assert result.file_id == "upload-1" and result.filename == "score.png" and result.size == 5
    storage.exists.assert_called_once_with(key)
    storage.put_bytes.assert_called_once_with(key=key, content=b"score", content_type="image/png")
    assert existing.model_dump() == before
    assert retain.call_args.args[1] == 3
    repository.create_upload.assert_awaited_once_with(
        db, stored_object_id=3, original_filename="score.png", uploader_user_id=1
    )
    commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_uploaded_file_rejects_non_owner() -> None:
    repository = Mock()
    repository.get_upload_by_uuid = AsyncMock(
        return_value=SimpleNamespace(
            id=1, upload_uuid="upload-1", stored_object_id=5, uploader_user_id=99
        )
    )
    service = FilesService(repository=repository)
    db = AsyncMock()
    current_user = SimpleNamespace(id=1)

    with pytest.raises(UnauthorizedException) as context:
        await service.delete_uploaded_file(db, current_user, "test.png")

    assert context.value.code == ErrorCode.NO_DELETE_ACCESS
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_delete_uploaded_file_removes_owned_file_and_record() -> None:
    repository = Mock()
    repository.get_upload_by_uuid = AsyncMock(
        return_value=SimpleNamespace(
            id=7, upload_uuid="upload-owned", uploader_user_id=1, stored_object_id=5
        )
    )
    repository.upload_reference_count = AsyncMock(return_value=0)
    repository.delete_upload_by_id = AsyncMock()
    service = FilesService(repository=repository)
    db = AsyncMock()
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
        service = FilesService(repository=repository, storage=storage)
        with (
            patch(
                "app.modules.files.service.storage_usage_service.record_release"
            ) as release_usage,
            patch(
                "app.modules.files.service.retire_after_release", return_value=["retirement"]
            ) as retire,
        ):
            result = await service.delete_uploaded_file(db, current_user, "owned.png")

    assert result.filename == "owned.png"
    repository.delete_upload_by_id.assert_awaited_once_with(db, 7)
    retire.assert_awaited_once_with(db, 5)
    assert release_usage.call_args.kwargs["auto_commit"] is False
    release_usage.assert_awaited_once()
    db.commit.assert_awaited_once()


def test_avatar_delivery_uses_stable_application_url_and_fresh_capability():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.core.exception_handlers import register_exception_handlers
    from app.modules.account.router import router
    from app.modules.account.dependencies import get_avatar_service
    from app.modules.account.avatar_service import AvatarService
    from PIL import Image

    storage = InMemoryObjectStorage()
    service = AvatarService(storage=storage)
    image = io.BytesIO()
    Image.new("RGB", (2, 2), "red").save(image, format="PNG")
    current = service.process_avatar(image.getvalue(), "avatar.png", 42)
    filename = current.object_key.rsplit("/", 1)[-1]
    url = avatar_url_for_user(User(avatar_object=current))
    assert url == f"/api/v1/account/avatars/{filename}"
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(router, prefix="/api/v1/account")
    app.dependency_overrides[get_avatar_service] = lambda: service
    from app.api.deps import get_db

    db = Mock()
    db.scalar = AsyncMock(return_value=current)

    async def avatar_db():
        yield db

    app.dependency_overrides[get_db] = avatar_db
    capabilities = ["https://objects.example/lease-one", "https://objects.example/lease-two"]
    storage.download_url = Mock(side_effect=capabilities)
    with TestClient(app, follow_redirects=False) as client:
        response = client.get(url)
        assert response.status_code == 307
        assert response.headers["location"] == capabilities[0]
        assert client.get(url).headers["location"] == capabilities[1]
        assert (
            storage.download_url.call_args_list
            == [call(f"avatars/{filename}", content_type="image/jpeg")] * 2
        )
        assert storage.object_metadata(f"avatars/{filename}").content_type == "image/jpeg"
        storage.delete(f"avatars/{filename}")
        assert client.get(url).status_code == 404
        assert client.get("/api/v1/account/avatars/other.jpg").status_code == 404
