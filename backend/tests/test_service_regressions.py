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
    ValidationException,
)
from app.core.settings.practice_runtime import get_practice_runtime_settings
from app.processing.engines.practice_alignment.contracts import AlignmentUpdate
from app.processing.engines.practice_alignment.reference_runtime import generate_score_audio, normalize_audio_waveform
from app.processing.engines.practice_alignment.audio_features import feature_matrix
from app.db.models.user import User
from app.db.models.practice import (
    PracticeAttempt,
    PracticeAttemptCompletionStatus,
    PracticeAttemptResolutionReason,
    PracticeAttemptResult,
    PracticeEvaluationProfile,
    PracticeInputSource,
    PracticeProgressionMode,
    PracticeRealtimeGuidance,
    PracticeSessionCompletionReason,
    PracticeSessionSummaryStatus,
    PracticeSessionState,
)
from app.db.models.score_access import AccessOrigin
from app.db.models.import_job import ImportJobState
from app.modules.files.service import FilesService
from app.modules.practice.read_model import PracticeReadModel
from app.modules.practice.service import PracticeService
from app.processing.performance.evidence import (
    PerformanceObservation,
    PerformanceObservationSource,
)
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


@pytest.mark.asyncio
async def test_practice_service_create_session_rejects_missing_score() -> None:
    access_policy = Mock()
    access_policy.authorize = AsyncMock(
        side_effect=ResourceNotFoundException("score", "missing-score", ErrorCode.SCORE_NOT_FOUND)
    )
    service = PracticeService(access_policy=access_policy)

    with pytest.raises(ResourceNotFoundException) as context:
        await service.create_session(
            AsyncMock(),
            score_uuid="missing-score",
            user_id=1,
            revision_uuid=None,
            sample_rate=16000,
            channels=1,
            frame_format="pcm_s16le",
        )

    assert context.value.code == ErrorCode.SCORE_NOT_FOUND


@pytest.mark.asyncio
async def test_practice_service_rejects_missing_canonical_revision_source() -> None:
    access_policy = Mock()
    access_policy.authorize = AsyncMock(
        return_value=SimpleNamespace(
            score=SimpleNamespace(id=101, score_uuid="score-1"),
            revision=SimpleNamespace(id=201, revision_uuid="revision-1"),
            origin=AccessOrigin.OWNER,
            grant=None,
        )
    )
    asset_repository = Mock()
    asset_repository.canonical_source = AsyncMock(return_value=None)
    service = PracticeService(
        access_policy=access_policy,
        asset_repository=asset_repository,
    )

    with pytest.raises(ResourceNotFoundException) as context:
        await service.create_session(
            AsyncMock(),
            score_uuid="score-1",
            user_id=1,
            revision_uuid="revision-1",
            sample_rate=16000,
            channels=1,
            frame_format="pcm_s16le",
        )

    assert context.value.code == ErrorCode.FILE_NOT_FOUND


@pytest.mark.asyncio
async def test_practice_service_create_session_pins_share_revision_without_storing_token() -> None:
    repository = Mock()
    repository.create_session = AsyncMock(
        return_value=SimpleNamespace(
            session_uuid="session-1",
            state=PracticeSessionState.CREATED,
        )
    )
    runtime_registry = Mock()
    access_policy = Mock()
    access_policy.authorize = AsyncMock(
        return_value=SimpleNamespace(
            score=SimpleNamespace(id=101, score_uuid="score-1"),
            revision=SimpleNamespace(id=201, revision_uuid="revision-1"),
            origin=AccessOrigin.SHARE,
            grant=SimpleNamespace(id=301),
        )
    )
    asset_repository = Mock()
    asset_repository.canonical_source = AsyncMock(
        return_value=SimpleNamespace(
            storage_key="scores/score-1/revisions/revision-1/score.musicxml"
        )
    )
    storage = Mock()
    storage.local_path.return_value = "C:/tmp/final.xml"
    storage.materialize_to_local.return_value = "C:/tmp/final.xml"
    service = PracticeService(
        repository=repository,
        runtime_registry=runtime_registry,
        access_policy=access_policy,
        asset_repository=asset_repository,
        storage=storage,
    )

    result = await service.create_session(
        AsyncMock(),
        score_uuid="score-1",
        user_id=2,
        revision_uuid=None,
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
    )

    assert result.session_id == "session-1"
    assert result.state == PracticeSessionState.CREATED
    assert result.ws_url == "/api/v1/practice/sessions/session-1/stream"
    runtime_registry.register.assert_not_called()
    created_session = repository.create_session.await_args.args[1]
    assert created_session.revision_id == 201
    assert created_session.share_grant_id == 301
    assert created_session.progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE
    assert created_session.realtime_guidance == PracticeRealtimeGuidance.GUIDED
    assert created_session.evaluation_profile == PracticeEvaluationProfile.LEARNING
    assert created_session.input_source == PracticeInputSource.MICROPHONE


@pytest.mark.asyncio
async def test_practice_service_pause_resume_and_finish_follow_valid_transitions() -> None:
    repository = Mock()
    session = SimpleNamespace(
        session_uuid="session-1",
        user_id=1,
        score_id=201,
        revision_id=301,
        access_origin=AccessOrigin.OWNER,
        state=PracticeSessionState.CREATED,
        progression_mode=PracticeProgressionMode.WAIT_FOR_NOTE,
        realtime_guidance=PracticeRealtimeGuidance.GUIDED,
        evaluation_profile=PracticeEvaluationProfile.LEARNING,
        input_source=PracticeInputSource.MICROPHONE,
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        scope_start_expected_group_id=None,
        scope_end_expected_group_id=None,
        scope_start_measure_number=None,
        scope_end_measure_number=None,
        started_at=None,
        finished_at=None,
        last_beat_position=None,
        last_confidence=None,
        completion_reason=None,
        summary_status=PracticeSessionSummaryStatus.NOT_REQUESTED,
        summary_payload=None,
    )
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    repository.save_session = AsyncMock(side_effect=lambda _db, saved_session: saved_session)
    library_service = Mock()
    library_service.mark_practiced = AsyncMock()
    service = PracticeService(repository=repository, library_service=library_service)
    db = AsyncMock()
    db.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model.__name__ == "Score"
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    paused = await service.pause_session(db, "session-1", user_id=1)
    assert paused.state == PracticeSessionState.PAUSED

    resumed = await service.resume_session(db, "session-1", user_id=1)
    assert resumed.state == PracticeSessionState.STREAMING
    assert session.started_at is not None

    finished = await service.finish_session(db, "session-1", user_id=1)
    assert finished.state == PracticeSessionState.FINISHED
    assert session.finished_at is not None


@pytest.mark.asyncio
async def test_practice_service_rejects_invalid_resume_state() -> None:
    repository = Mock()
    repository.get_session_by_uuid = AsyncMock(
        return_value=SimpleNamespace(
            session_uuid="session-1",
            user_id=1,
            state=PracticeSessionState.CREATED,
        )
    )
    service = PracticeService(repository=repository)

    with pytest.raises(ValidationException) as context:
        await service.resume_session(AsyncMock(), "session-1", user_id=1)

    assert context.value.code == ErrorCode.PRACTICE_SESSION_INVALID_STATE


@pytest.mark.asyncio
async def test_practice_service_persist_alignment_updates_latest_position() -> None:
    repository = Mock()
    session = SimpleNamespace(
        session_uuid="session-1",
        last_beat_position=None,
        last_confidence=None,
    )
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    repository.save_session = AsyncMock(side_effect=lambda _db, saved_session: saved_session)
    service = PracticeService(repository=repository)
    alignment: AlignmentUpdate = {
        "beat_position": 12.5,
        "confidence": 0.95,
        "alignment_confidence": 0.95,
        "audio_confidence": 0.95,
        "continuity_confidence": 0.95,
        "visual_confidence": 0.95,
        "timestamp_ms": 320,
        "scope_completed": False,
            "completion_reason": None,
        "audio_active": True,
        "input_rms": 0.04,
        "input_peak": 0.1,
        "input_health": {
            "available": True,
            "level": "good",
            "noise": "good",
            "confidence": 1.0,
        },
        "match_state": "matched",
    }

    await service.persist_alignment(AsyncMock(), "session-1", alignment)

    assert session.last_beat_position == 12.5
    assert session.last_confidence == 0.95


@pytest.mark.asyncio
async def test_practice_service_finish_session_persists_structured_summary_payload() -> None:
    repository = Mock()
    session = SimpleNamespace(
        id=1,
        session_uuid="session-1",
        user_id=1,
        score_id=11,
        state=PracticeSessionState.PAUSED,
        access_origin=AccessOrigin.OWNER,
        progression_mode=PracticeProgressionMode.WAIT_FOR_NOTE,
        realtime_guidance=PracticeRealtimeGuidance.GUIDED,
        evaluation_profile=PracticeEvaluationProfile.LEARNING,
        input_source=PracticeInputSource.MICROPHONE,
        started_at=None,
        finished_at=None,
        last_beat_position=18.5,
        last_confidence=0.88,
        completion_reason=None,
        summary_status=PracticeSessionSummaryStatus.NOT_REQUESTED,
        summary_payload=None,
        error=None,
    )
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    repository.save_session = AsyncMock(side_effect=lambda _db, saved_session: saved_session)
    repository.list_attempts_for_session = AsyncMock(
        return_value=[
            PracticeAttempt(
                session_id=1,
                attempt_index=1,
                attempt_uid="attempt-1",
                expected_group_id="entry-1",
                event_id="event-1",
                beat_position=4.0,
                render_note_ids='["n1", "n2"]',
                measure_numbers='["1"]',
                result=PracticeAttemptResult.PARTIAL,
                action="wait",
                completion_status=PracticeAttemptCompletionStatus.COMPLETED,
                resolution_reason=PracticeAttemptResolutionReason.PARTIAL_MATCH,
                experience_state="waiting_for_note",
                input_source=PracticeInputSource.MICROPHONE,
                evidence_profile="MICROPHONE_BEST_EFFORT",
                correctness_scope="acoustic_single_note_strict_chord_best_effort",
                confidence=0.45,
                timestamp_ms=100,
            ),
            PracticeAttempt(
                session_id=1,
                attempt_index=2,
                attempt_uid="attempt-2",
                expected_group_id="entry-1",
                event_id="event-1",
                beat_position=4.0,
                render_note_ids='["n1", "n2"]',
                measure_numbers='["1"]',
                result=PracticeAttemptResult.MATCH,
                action="advance",
                completion_status=PracticeAttemptCompletionStatus.COMPLETED,
                resolution_reason=PracticeAttemptResolutionReason.STABLE_MATCH,
                experience_state="following",
                input_source=PracticeInputSource.MICROPHONE,
                evidence_profile="MICROPHONE_BEST_EFFORT",
                correctness_scope="acoustic_single_note_strict_chord_best_effort",
                confidence=0.91,
                timestamp_ms=240,
            ),
            PracticeAttempt(
                session_id=1,
                attempt_index=3,
                attempt_uid="attempt-3",
                expected_group_id="entry-2",
                event_id="event-2",
                beat_position=5.0,
                render_note_ids='["n3"]',
                measure_numbers='["2"]',
                result=PracticeAttemptResult.MISMATCH,
                action="hold",
                completion_status=PracticeAttemptCompletionStatus.INTERRUPTED,
                resolution_reason=PracticeAttemptResolutionReason.CONNECTION_CLOSED,
                experience_state="paused",
                input_source=PracticeInputSource.MICROPHONE,
                evidence_profile="MICROPHONE_BEST_EFFORT",
                correctness_scope="acoustic_single_note_strict_chord_best_effort",
                confidence=0.4,
                timestamp_ms=300,
            ),
            PracticeAttempt(
                session_id=1,
                attempt_index=4,
                attempt_uid="attempt-4",
                expected_group_id="entry-3",
                event_id="event-3",
                beat_position=6.0,
                render_note_ids='["n4"]',
                measure_numbers='["3"]',
                result=PracticeAttemptResult.SKIPPED,
                action="skip",
                completion_status=PracticeAttemptCompletionStatus.COMPLETED,
                resolution_reason=PracticeAttemptResolutionReason.USER_SKIPPED,
                experience_state="skipped",
                input_source=PracticeInputSource.MICROPHONE,
                evidence_profile="MICROPHONE_BEST_EFFORT",
                correctness_scope="acoustic_single_note_strict_chord_best_effort",
                confidence=1.0,
                timestamp_ms=400,
            ),
        ]
    )
    library_service = Mock()
    library_service.mark_practiced = AsyncMock()
    read_model = Mock()
    read_model.to_session_detail = AsyncMock(return_value=SimpleNamespace(state=session.state))
    service = PracticeService(
        repository=repository,
        library_service=library_service,
        read_model=read_model,
    )
    db = AsyncMock()

    await service.finish_session(db, "session-1", user_id=1)
    await service.build_summary_for_finished_session(db, "session-1", user_id=1)
    result = PracticeReadModel().to_session_summary_result(session)

    assert result.summary_status == PracticeSessionSummaryStatus.READY
    assert result.summary_payload is not None
    assert result.summary_payload.metrics["input_source"] == "MICROPHONE"
    assert result.summary_payload.metrics["evidence_profile"] == "MICROPHONE_BEST_EFFORT"
    assert (
        result.summary_payload.metrics["correctness_scope"]
        == "acoustic_single_note_strict_chord_best_effort"
    )
    assert result.summary_payload.metrics["attempt_count"] == 4
    assert result.summary_payload.metrics["scorable_attempt_count"] == 2
    assert result.summary_payload.metrics["interrupted_attempts"] == 1
    assert result.summary_payload.metrics["skipped_attempts"] == 1
    assert result.summary_payload.metrics["scoring_coverage"] == 0.5
    assert result.summary_payload.metrics["target_count"] == 3
    assert result.summary_payload.metrics["scorable_target_count"] == 1
    assert result.summary_payload.metrics["completed_targets"] == 1
    assert result.summary_payload.metrics["scorable_completed_targets"] == 1
    assert result.summary_payload.metrics["interrupted_target_count"] == 1
    assert result.summary_payload.metrics["targets_with_partial"] == 1
    assert result.summary_payload.metrics["targets_with_mismatch"] == 0
    assert result.summary_payload.metrics["target_completion_rate"] == 0.333
    assert result.summary_payload.metrics["scorable_target_completion_rate"] == 1.0
    assert [target.expected_group_id for target in result.summary_payload.targets] == [
        "entry-1",
        "entry-2",
        "entry-3",
    ]
    first_target = result.summary_payload.targets[0]
    assert first_target.measure_numbers == ["1"]
    assert first_target.attempt_count == 2
    assert first_target.completed is True
    assert first_target.partial_attempt_count == 1
    second_target = result.summary_payload.targets[1]
    assert second_target.measure_numbers == ["2"]
    assert second_target.interrupted_attempt_count == 1
    assert second_target.completed is False
    third_target = result.summary_payload.targets[2]
    assert third_target.measure_numbers == ["3"]
    assert third_target.skipped_attempt_count == 1
    assert third_target.completed is False
    assert [measure.measure_number for measure in result.summary_payload.problem_measures] == [
        "1",
        "2",
        "3",
    ]
    hardest_measure = result.summary_payload.problem_measures[0]
    assert hardest_measure.incomplete_target_count == 0
    assert hardest_measure.interrupted_attempt_count == 0
    interrupted_only_measure = result.summary_payload.problem_measures[1]
    assert interrupted_only_measure.incomplete_target_count == 1
    assert interrupted_only_measure.interrupted_attempt_count == 1
    skipped_measure = result.summary_payload.problem_measures[2]
    assert skipped_measure.incomplete_target_count == 1
    assert skipped_measure.skipped_attempt_count == 1
    assert session.summary_status == PracticeSessionSummaryStatus.READY
    assert session.summary_payload is not None
    assert repository.save_session.await_count == 2


@pytest.mark.asyncio
async def test_practice_service_finish_session_marks_midi_as_strict_evidence() -> None:
    repository = Mock()
    session = SimpleNamespace(
        id=1,
        session_uuid="session-1",
        user_id=1,
        score_id=11,
        state=PracticeSessionState.PAUSED,
        access_origin=AccessOrigin.OWNER,
        progression_mode=PracticeProgressionMode.WAIT_FOR_NOTE,
        realtime_guidance=PracticeRealtimeGuidance.GUIDED,
        evaluation_profile=PracticeEvaluationProfile.LEARNING,
        input_source=PracticeInputSource.MIDI,
        started_at=None,
        finished_at=None,
        last_beat_position=18.5,
        last_confidence=1.0,
        completion_reason=None,
        summary_status=PracticeSessionSummaryStatus.NOT_REQUESTED,
        summary_payload=None,
        error=None,
    )
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    repository.save_session = AsyncMock(side_effect=lambda _db, saved_session: saved_session)
    repository.list_attempts_for_session = AsyncMock(return_value=[])
    repository.has_replay_artifact_for_session = AsyncMock(return_value=False)
    library_service = Mock()
    library_service.mark_practiced = AsyncMock()
    read_model = Mock()
    read_model.to_session_detail = AsyncMock(return_value=SimpleNamespace(state=session.state))
    service = PracticeService(
        repository=repository,
        library_service=library_service,
        read_model=read_model,
    )
    db = AsyncMock()

    await service.finish_session(db, "session-1", user_id=1)
    await service.build_summary_for_finished_session(db, "session-1", user_id=1)
    result = PracticeReadModel().to_session_summary_result(session)

    assert result.summary_payload is not None
    assert result.summary_payload.metrics["input_source"] == "MIDI"
    assert result.summary_payload.metrics["evidence_profile"] == "MIDI_STRICT"
    assert result.summary_payload.metrics["correctness_scope"] == "symbolic_exact_notes"


@pytest.mark.asyncio
async def test_practice_service_finish_performance_session_builds_conservative_summary() -> None:
    repository = Mock()
    started_at = utc_now_naive() - timedelta(seconds=1)
    session = SimpleNamespace(
        id=1,
        session_uuid="session-1",
        user_id=1,
        score_id=11,
        state=PracticeSessionState.STREAMING,
        access_origin=AccessOrigin.OWNER,
        progression_mode=PracticeProgressionMode.CONTINUOUS,
        realtime_guidance=PracticeRealtimeGuidance.STATUS_ONLY,
        evaluation_profile=PracticeEvaluationProfile.PERFORMANCE,
        input_source=PracticeInputSource.MICROPHONE,
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        scope_start_expected_group_id=None,
        scope_end_expected_group_id=None,
        scope_start_measure_number=None,
        scope_end_measure_number=None,
        started_at=started_at,
        finished_at=None,
        last_beat_position=None,
        last_confidence=None,
        completion_reason=None,
        summary_status=PracticeSessionSummaryStatus.NOT_REQUESTED,
        summary_payload=None,
        error=None,
    )
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    repository.save_session = AsyncMock(side_effect=lambda _db, saved_session: saved_session)
    repository.list_attempts_for_session = AsyncMock(return_value=[])
    repository.has_replay_artifact_for_session = AsyncMock(return_value=False)
    library_service = Mock()
    library_service.mark_practiced = AsyncMock()
    read_model = Mock()
    read_model.to_session_detail = AsyncMock(return_value=SimpleNamespace(state=session.state))
    service = PracticeService(
        repository=repository,
        library_service=library_service,
        read_model=read_model,
    )
    db = AsyncMock()

    await service.finish_session(
        db,
        "session-1",
        user_id=1,
        completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
    )
    await service.build_summary_for_finished_session(
        db,
        "session-1",
        user_id=1,
        performance_observations=(
            PerformanceObservation(
                source=PerformanceObservationSource.MICROPHONE,
                session_time_ms=0,
                performance_time_ms=0.0,
                duration_ms=500,
                active=True,
                analyzable=True,
                confidence=0.9,
            ),
        ),
    )
    result = PracticeReadModel().to_session_summary_result(session)

    assert result.summary_status == PracticeSessionSummaryStatus.READY
    assert result.summary_payload is not None
    assert result.summary_payload.metrics["evaluation_profile"] == "PERFORMANCE"
    assert result.summary_payload.metrics["completion_reason"] == "SCOPE_COMPLETED"
    assert result.summary_payload.metrics["scope_kind"] == "FULL_PIECE"
    assert result.summary_payload.metrics["input_source"] == "MICROPHONE"
    assert result.summary_payload.metrics["analyzable_coverage"] is not None
    assert result.summary_payload.metrics["analyzable_coverage"] > 0.0
    assert result.summary_payload.metrics["confident_coverage"] is not None
    assert result.summary_payload.metrics["confident_coverage"] > 0.0
    assert result.summary_payload.targets == []
    assert result.summary_payload.problem_measures == []


@pytest.mark.asyncio
async def test_practice_service_get_summary_parses_existing_payload() -> None:
    repository = Mock()
    session = SimpleNamespace(
        session_uuid="session-1",
        user_id=1,
        state=PracticeSessionState.FINISHED,
        evaluation_profile=PracticeEvaluationProfile.LEARNING,
        summary_status=PracticeSessionSummaryStatus.READY,
        summary_payload='{"metrics":{"state":"FINISHED"},"targets":[],"problem_measures":[]}',
    )
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    service = PracticeService(repository=repository)

    result = await service.get_summary(AsyncMock(), "session-1", user_id=1)

    assert result.session_id == "session-1"
    assert result.summary_status == PracticeSessionSummaryStatus.READY
    assert result.summary_payload is not None
    assert result.summary_payload.metrics == {"state": "FINISHED"}
