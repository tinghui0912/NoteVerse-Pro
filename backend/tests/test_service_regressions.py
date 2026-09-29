from __future__ import annotations

import os
import io
import tempfile
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import numpy as np
import pytest
from PIL import Image

from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.core.settings.practice_runtime import get_practice_runtime_settings
from app.processing.engines.practice_alignment.reference_runtime import generate_score_audio, normalize_audio_waveform
from app.processing.engines.practice_alignment.audio_features import feature_matrix
from app.db.models.user import User
from app.db.models.import_job import ImportJobState
from app.modules.files.service import FilesService
from app.modules.account.avatar_service import AvatarService
from app.modules.account.profile_service import ProfileService
from app.modules.import_jobs.execution_service import ImportJobExecutionService
from app.modules.import_jobs.maintenance_service import ImportJobMaintenanceService
from app.modules.import_jobs.worker_service import sync_import_job_service
from app.modules.import_jobs.submission_service import ImportJobSubmissionService
from app.modules.scores.schemas import ScoreTaxonomyTagInput
from app.pipeline.files_recorder import _build_file_item
from app.shared.constants import ErrorCode
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.storage import LocalFileStorage
from app.storage.s3 import S3CompatibleStorage
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


class FakeAvatarDb:
    def __init__(self) -> None:
        self.commits = 0
        self.refreshes = 0

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, _record: object) -> None:
        self.refreshes += 1


def test_allowed_file_accepts_supported_extensions() -> None:
    service = FilesService(repository=Mock())

    assert service.allowed_file("score.png") is True
    assert service.allowed_file("score.TIFF") is True
    assert service.allowed_file("score.pdf") is False
    assert service.allowed_file("score") is False


def test_matchmaker_audio_generation_uses_configured_soundfont(monkeypatch, tmp_path) -> None:
    soundfont_path = tmp_path / "practice.sf2"
    soundfont_path.write_bytes(b"soundfont")
    monkeypatch.setenv("PRACTICE_SOUNDFONT_PATH", str(soundfont_path))
    get_practice_runtime_settings.cache_clear()

    class FakeScore:
        def note_array(self):
            return {
                "onset_beat": np.array([0.0, 1.0]),
                "onset_div": np.array([0.0, 1.0]),
            }

        def inv_beat_map(self, value):
            return value

        def quarter_duration_map(self, value):
            return 1.0

    partitura = SimpleNamespace(save_wav_fluidsynth=Mock(return_value=np.ones(100)))
    default_generate_score_audio = Mock()

    try:
        audio = generate_score_audio(
            score=FakeScore(),
            bpm=120,
            sample_rate=10,
            np=np,
            partitura=partitura,
            generate_score_audio=default_generate_score_audio,
        )
    finally:
        get_practice_runtime_settings.cache_clear()

    default_generate_score_audio.assert_not_called()
    partitura.save_wav_fluidsynth.assert_called_once()
    assert partitura.save_wav_fluidsynth.call_args.kwargs["soundfont"] == str(soundfont_path)
    assert audio.shape == (6,)


def test_matchmaker_reference_audio_normalization_handles_tuple_and_stereo() -> None:
    stereo_audio = np.array(
        [
            [1.0, 3.0],
            [2.0, 4.0],
            [3.0, 5.0],
        ],
        dtype=np.float32,
    )

    normalized = normalize_audio_waveform(
        (stereo_audio, 16000, "extra"),
        np,
    )

    assert normalized.shape == (3,)
    np.testing.assert_allclose(normalized, np.array([2.0, 3.0, 4.0], dtype=np.float32))


def test_matchmaker_feature_matrix_extracts_processor_tuple_output() -> None:
    features = np.ones((3, 12), dtype=np.float32)

    extracted = feature_matrix((features, {"frame_time": 0.0}))

    assert extracted is features


def test_local_file_storage_saves_and_materializes_blob() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = LocalFileStorage(storage_root=temp_dir)
        stored = storage.save_blob(
            content=b"score",
            sha256="abc123",
            extension=".png",
        )

        assert stored.filename == "abc123.png"
        assert stored.size_bytes == 5
        assert stored.storage_key == "blobs/ab/abc123.png"
        assert (
            storage.materialize_to_local(stored.storage_key, storage.local_path(stored.storage_key))
            == stored.path
        )


def test_local_file_storage_delete_blob_is_idempotent() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = LocalFileStorage(storage_root=temp_dir)
        stored = storage.save_blob(
            content=b"score",
            sha256="abc123",
            extension=".png",
        )

        assert storage.delete(stored.storage_key) is True
        assert storage.delete(stored.storage_key) is False


def test_local_file_storage_rejects_path_traversal_keys() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = LocalFileStorage(storage_root=temp_dir)

        with pytest.raises(ValueError):
            storage.put_bytes(key="../escape.txt", content=b"bad")


def test_files_recorder_uploads_task_output_to_storage_key() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = LocalFileStorage(storage_root=temp_dir)
        output_path = os.path.join(temp_dir, "preview-01.svg")
        with open(output_path, "w", encoding="utf-8") as file_handle:
            file_handle.write("<svg />")

        with patch("app.pipeline.files_recorder.file_storage", storage):
            item = _build_file_item(
                "task-1",
                "preview_image",
                output_path,
                page=1,
            )

        assert item["storage_backend"] == "local"
        assert item["storage_key"] == "jobs/task-1/preview_image/001-preview-01.svg"
        assert item["filename"] == "001-preview-01.svg"
        assert item["page_number"] == 1
        assert item["mime_type"] == "image/svg+xml"
        assert item["size"] == 7
        assert storage.exists(item["storage_key"])


def test_files_recorder_uses_file_kind_values_in_storage_keys() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = LocalFileStorage(storage_root=temp_dir)
        output_path = os.path.join(temp_dir, "input.jpg")
        with open(output_path, "wb") as file_handle:
            file_handle.write(b"jpg")

        with patch("app.pipeline.files_recorder.file_storage", storage):
            item = _build_file_item(
                "task-1",
                ImportArtifactKind.REVIEW_MUSICXML,
                output_path,
                page=1,
            )

        assert item["storage_key"] == "jobs/task-1/review_musicxml/001-input.jpg"
        assert "ImportArtifactKind" not in item["storage_key"]


def test_avatar_service_stores_processed_image_through_storage() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = LocalFileStorage(storage_root=temp_dir)
        service = AvatarService(storage=storage)
        image = Image.new("RGB", (20, 20), (255, 0, 0))
        image_bytes = io.BytesIO()
        image.save(image_bytes, format="PNG")

        filename, avatar_url = service.process_avatar(
            file_bytes=image_bytes.getvalue(),
            filename="avatar.png",
            user_id=7,
        )

        assert filename.startswith("7_")
        assert filename.endswith(".jpg")
        assert avatar_url == f"/api/v1/uploads/avatars/{filename}"
        assert storage.delete_avatar(filename) is True


def test_avatar_service_detects_missing_local_avatar() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = LocalFileStorage(storage_root=temp_dir)
        service = AvatarService(storage=storage)

        assert service.avatar_exists("missing.jpg") is False


def test_profile_payload_does_not_repair_missing_avatar_reference() -> None:
    user = User(
        id=7,
        email="user@example.com",
        display_name="User",
        password_hash="hash",
        avatar_url="/api/v1/uploads/avatars/missing.jpg",
    )

    payload = ProfileService().profile_payload(user)

    assert payload.user.avatar_url == "/api/v1/uploads/avatars/missing.jpg"
    assert user.avatar_url == "/api/v1/uploads/avatars/missing.jpg"


@pytest.mark.asyncio
async def test_avatar_service_replaces_user_avatar_and_deletes_old_file() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = LocalFileStorage(storage_root=temp_dir)
        service = AvatarService(storage=storage)
        old = storage.save_avatar(content=b"old", filename="old.jpg")
        user = User(
            id=7,
            email="user@example.com",
            display_name="User",
            password_hash="hash",
            avatar_url=old.public_url or storage.avatar_url("old.jpg"),
        )
        db = FakeAvatarDb()
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
        assert user.avatar_url == avatar_url
        assert storage.exists(f"avatars/{filename}")
        assert not storage.exists("avatars/old.jpg")
        assert db.commits == 1
        assert db.refreshes == 1


def test_s3_storage_saves_and_materializes_blob() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = S3CompatibleStorage()
        storage.bucket = "bucket"
        storage.endpoint_url = "https://oss-cn-shenzhen.aliyuncs.com"
        storage.public_base_url = "https://cdn.example"
        storage._client = FakeS3Client()

        with patch("app.storage.s3.settings.WORK_ROOT", temp_dir):
            stored = storage.save_blob(
                content=b"score",
                sha256="abc123",
                extension=".png",
            )
            path = storage.materialize_to_local(
                stored.storage_key, storage.local_path(stored.storage_key)
            )

        assert stored.storage_key == "blobs/ab/abc123.png"
        assert stored.public_url == "https://cdn.example/blobs/ab/abc123.png"
        assert os.path.exists(path)
        with open(path, "rb") as file_handle:
            assert file_handle.read() == b"score"


def test_s3_storage_avatar_public_url_uses_stable_object_url() -> None:
    storage = S3CompatibleStorage()
    storage.bucket = "sky-itcast7788"
    storage.endpoint_url = "https://oss-cn-shenzhen.aliyuncs.com"
    storage.public_base_url = None
    storage._client = FakeS3Client()

    stored = storage.save_avatar(content=b"jpg", filename="avatar.jpg")

    assert stored.storage_key == "avatars/avatar.jpg"
    assert stored.public_url == (
        "https://sky-itcast7788.oss-cn-shenzhen.aliyuncs.com/avatars/avatar.jpg"
    )


def test_import_job_maintenance_deletes_orphan_upload_file_and_row() -> None:
    repository = Mock()
    storage = Mock()
    storage.delete.return_value = True
    service = ImportJobMaintenanceService(repository=repository, storage=storage)
    db = Mock()

    upload = SimpleNamespace(
        id=3,
        upload_uuid="upload-orphan",
        blob_id=9,
        uploader_user_id=7,
        created_at=utc_now_naive() - timedelta(days=2),
    )
    blob = SimpleNamespace(id=9, size_bytes=123, storage_key="blobs/or/orphan.png")
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
    ):
        deleted = service.cleanup_orphan_uploads(db)

    assert deleted == 1
    storage.delete.assert_called_once_with("blobs/or/orphan.png")
    release_usage.assert_called_once()
    assert release_usage.call_args.kwargs["user_id"] == 7
    assert release_usage.call_args.kwargs["bytes_count"] == 123
    assert release_usage.call_args.kwargs["storage_key"] == "blobs/or/orphan.png"
    db.delete.assert_any_call(upload)
    db.delete.assert_any_call(blob)
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
    storage.local_path.return_value = "C:/worker/cache/blob.png"
    storage.materialize_to_local.return_value = "C:/worker/cache/score.png"
    service = ImportJobExecutionService(storage=storage)

    assert service._resolve_input_paths(["blobs/ab/abc123.png"]) == ["C:/worker/cache/score.png"]
    storage.local_path.assert_called_once_with("blobs/ab/abc123.png")
    storage.materialize_to_local.assert_called_once_with(
        "blobs/ab/abc123.png",
        "C:/worker/cache/blob.png",
    )


def test_import_job_submission_rejects_upload_owned_by_another_user() -> None:
    service = ImportJobSubmissionService(storage=Mock())
    sync_db = Mock()
    upload = SimpleNamespace(uploader_user_id=99, blob_id=3)
    sync_db.get.return_value = SimpleNamespace(
        storage_backend=service.storage.backend_name, storage_key="blobs/ab/abc123.png"
    )

    with patch("app.db.sync_session.get_db_session", return_value=sync_db):
        with patch.object(
            sync_import_job_service.repository, "get_upload_by_uuid", return_value=upload
        ):
            with pytest.raises(ResourceNotFoundException) as context:
                service._ensure_uploads_exist(5, ["abc"])

    assert context.value.code == ErrorCode.FILE_NOT_FOUND
    sync_db.close.assert_called_once()


@pytest.mark.asyncio
async def test_file_upload_rehomes_existing_blob_when_storage_backend_changes() -> None:
    repository = Mock()
    existing_blob = SimpleNamespace(
        id=3,
        storage_backend="local",
        storage_key="blobs/ab/existing.png",
        filename="existing.png",
        size_bytes=3,
        mime_type="image/png",
    )
    updated_blob = SimpleNamespace(
        id=3,
        storage_backend="s3",
        storage_key="blobs/ba/new.png",
        filename="new.png",
        size_bytes=5,
        mime_type="image/png",
    )
    upload_record = SimpleNamespace(upload_uuid="upload-1")
    repository.get_blob_by_sha256 = AsyncMock(return_value=existing_blob)
    repository.update_blob_storage = AsyncMock(return_value=updated_blob)
    repository.create_blob = AsyncMock()
    repository.create_upload = AsyncMock(return_value=upload_record)
    storage = Mock()
    storage.backend_name = "s3"
    storage.exists.return_value = False
    storage.save_blob.return_value = SimpleNamespace(
        storage_key="blobs/ba/new.png",
        filename="new.png",
        size_bytes=5,
    )
    db = AsyncMock()
    user = SimpleNamespace(id=1)
    upload = SimpleNamespace(
        filename="score.png",
        content_type="image/png",
        read=AsyncMock(return_value=b"score"),
    )

    with patch("app.modules.files.service.storage_usage_service.reserve") as reserve_mock:
        reserve_mock.return_value = SimpleNamespace(reservation_id="reservation-1")
        with patch(
            "app.modules.files.service.storage_usage_service.commit_reservation"
        ) as commit_mock:
            result = await FilesService(repository=repository, storage=storage).upload_file(
                db, user, upload
            )

    assert result.file_id == "upload-1"
    assert result.filename == "score.png"
    assert result.size == 5
    storage.exists.assert_not_called()
    storage.save_blob.assert_called_once()
    repository.create_blob.assert_not_called()
    repository.update_blob_storage.assert_awaited_once_with(
        db,
        existing_blob,
        storage_backend="s3",
        storage_key="blobs/ba/new.png",
        filename="new.png",
        size_bytes=5,
        mime_type="image/png",
    )
    repository.create_upload.assert_awaited_once_with(
        db,
        blob_id=3,
        original_filename="score.png",
        uploader_user_id=1,
    )
    commit_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_uploaded_file_rejects_non_owner() -> None:
    repository = Mock()
    repository.get_upload_by_uuid = AsyncMock(
        return_value=SimpleNamespace(id=1, upload_uuid="upload-1", blob_id=5, uploader_user_id=99)
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
            id=7, upload_uuid="upload-owned", uploader_user_id=1, blob_id=5
        )
    )
    repository.upload_reference_count = AsyncMock(return_value=0)
    repository.delete_upload_by_id = AsyncMock()
    repository.blob_upload_count = AsyncMock(return_value=0)
    repository.delete_blob_by_id = AsyncMock()
    service = FilesService(repository=repository)
    db = AsyncMock()
    db.get.return_value = SimpleNamespace(
        id=5,
        size_bytes=3,
        storage_key="blobs/ow/owned.png",
    )
    current_user = SimpleNamespace(id=1)

    with tempfile.TemporaryDirectory() as temp_dir:
        blob_dir = os.path.join(temp_dir, "blobs", "ow")
        os.makedirs(blob_dir, exist_ok=True)
        file_path = os.path.join(blob_dir, "owned.png")
        with open(file_path, "wb") as file_handle:
            file_handle.write(b"png")

        storage = LocalFileStorage(storage_root=temp_dir)
        service = FilesService(repository=repository, storage=storage)
        with patch(
            "app.modules.files.service.storage_usage_service.record_release"
        ) as release_usage:
            result = await service.delete_uploaded_file(db, current_user, "owned.png")

    assert result.filename == "owned.png"
    repository.delete_upload_by_id.assert_awaited_once_with(db, 7)
    repository.delete_blob_by_id.assert_awaited_once_with(db, 5)
    release_usage.assert_awaited_once()
    db.commit.assert_awaited_once()
