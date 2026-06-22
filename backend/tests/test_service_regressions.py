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
from app.processing.engines.matchmaker_live import (
    AlignmentUpdate,
    BrowserAudioStreamAdapter,
    MatchmakerLiveEngine,
)
from app.db.models.practice import PracticeReportStatus, PracticeSessionState
from app.db.models.score_access import AccessOrigin
from app.modules.files.service import FilesService
from app.modules.practice.service import PracticeService
from app.modules.profile.service import AvatarService
from app.modules.jobs.execution_service import JobExecutionService
from app.modules.jobs.maintenance_service import JobMaintenanceService
from app.modules.jobs.worker_service import sync_job_service
from app.modules.jobs.submission_service import JobSubmissionService
from app.pipeline.files_recorder import _build_file_item
from app.shared.constants import ErrorCode
from app.shared.file_kinds import FileKind
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
        contents = [
            {"Key": key, "Size": len(self.objects[key])}
            for key in sorted(keys)[:MaxKeys]
        ]
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


def test_matchmaker_audio_generation_uses_configured_soundfont(monkeypatch, tmp_path) -> None:
    soundfont_path = tmp_path / "practice.sf2"
    soundfont_path.write_bytes(b"soundfont")
    monkeypatch.setattr(
        "app.processing.engines.matchmaker_live.settings.PRACTICE_SOUNDFONT_PATH",
        str(soundfont_path),
    )

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

    audio = MatchmakerLiveEngine._generate_score_audio(
        score=FakeScore(),
        bpm=120,
        sample_rate=10,
        np=np,
        partitura=partitura,
        generate_score_audio=default_generate_score_audio,
    )

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

    normalized = MatchmakerLiveEngine._normalize_audio_waveform(
        (stereo_audio, 16000, "extra"),
        np,
    )

    assert normalized.shape == (3,)
    np.testing.assert_allclose(normalized, np.array([2.0, 3.0, 4.0], dtype=np.float32))


def test_matchmaker_feature_matrix_extracts_processor_tuple_output() -> None:
    features = np.ones((3, 12), dtype=np.float32)

    extracted = BrowserAudioStreamAdapter._feature_matrix(
        (features, {"frame_time": 0.0})
    )

    assert extracted is features


def test_preview_file_raises_not_found_for_missing_file() -> None:
    storage = Mock()
    storage.score_upload_exists.return_value = False
    service = FilesService(repository=Mock(), storage=storage)

    with pytest.raises(ResourceNotFoundException) as context:
        service.preview_file("missing.png")

    assert context.value.code == ErrorCode.FILE_NOT_FOUND


def test_preview_file_returns_signed_redirect_for_object_storage() -> None:
    storage = Mock()
    storage.backend_name = "s3"
    storage.score_upload_exists.return_value = True
    storage.exists.return_value = True
    storage.download_url.return_value = "https://signed.example/scores/score.png"
    service = FilesService(repository=Mock(), storage=storage)

    delivery = service.preview_file("score.png")

    assert delivery.redirect_url == "https://signed.example/scores/score.png"
    assert delivery.path is None
    storage.download_url.assert_called_once_with(
        "scores/score.png",
        filename="score.png",
        content_type="image/png",
    )
    storage.score_upload_path.assert_not_called()


def test_preview_file_falls_back_to_local_path_without_download_url() -> None:
    storage = Mock()
    storage.backend_name = "local"
    storage.score_upload_exists.return_value = True
    storage.score_upload_path.return_value = "C:/tmp/scores/score.png"
    service = FilesService(repository=Mock(), storage=storage)

    delivery = service.preview_file("score.png")

    assert delivery.path == "C:/tmp/scores/score.png"


@pytest.mark.asyncio
async def test_file_access_url_returns_inline_signed_url_for_object_storage() -> None:
    repository = Mock()
    repository.get_task_by_uuid = AsyncMock(return_value=SimpleNamespace(id=10, task_uuid="task-1"))
    repository.list_task_files_by_kind = AsyncMock(
        return_value=[
            SimpleNamespace(
                storage_key="tasks/task-1/preview_image/001.svg",
                filename="001.svg",
                mime_type="image/svg+xml",
            )
        ]
    )
    storage = Mock()
    storage.backend_name = "s3"
    storage.exists.return_value = True
    storage.download_url.return_value = "https://signed.example/tasks/task-1/preview_image/001.svg"
    service = FilesService(repository=repository, storage=storage)

    with patch("app.modules.files.service.check_task_view_access", AsyncMock(return_value=True)):
        result = await service.get_task_file_access_url(
            AsyncMock(),
            SimpleNamespace(id=1),
            "task-1",
            "preview_image",
            1,
        )

    assert result["url"] == "https://signed.example/tasks/task-1/preview_image/001.svg"
    assert result["filename"] == "001.svg"
    assert result["mime_type"] == "image/svg+xml"
    storage.download_url.assert_called_once_with("tasks/task-1/preview_image/001.svg")


def test_local_file_storage_saves_and_resolves_score_upload() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = LocalFileStorage(storage_root=temp_dir)
        stored = storage.save_score_upload(
            content=b"score",
            sha256="abc123",
            extension=".png",
        )

        assert stored.filename == "abc123.png"
        assert stored.size_bytes == 5
        assert storage.resolve_score_uploads(["abc123"]) == [stored.path]


def test_local_file_storage_delete_score_upload_is_idempotent() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = LocalFileStorage(storage_root=temp_dir)
        storage.save_score_upload(
            content=b"score",
            sha256="abc123",
            extension=".png",
        )

        assert storage.delete_score_upload("abc123.png") is True
        assert storage.delete_score_upload("abc123.png") is False


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
                FileKind.ORIGINAL_IMAGE,
                output_path,
                page=1,
            )

        assert item["storage_key"] == "jobs/task-1/original_image/001-input.jpg"
        assert "FileKind" not in item["storage_key"]


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


def test_s3_storage_saves_and_materializes_score_upload() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        storage = S3CompatibleStorage()
        storage.bucket = "bucket"
        storage.endpoint_url = "https://oss-cn-shenzhen.aliyuncs.com"
        storage.public_base_url = "https://cdn.example"
        storage._client = FakeS3Client()

        with patch("app.storage.s3.settings.WORK_ROOT", temp_dir):
            stored = storage.save_score_upload(
                content=b"score",
                sha256="abc123",
                extension=".png",
            )
            paths = storage.resolve_score_uploads(["abc123"])

        assert stored.storage_key == "scores/abc123.png"
        assert stored.public_url == "https://cdn.example/scores/abc123.png"
        assert len(paths) == 1
        assert os.path.exists(paths[0])
        with open(paths[0], "rb") as file_handle:
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


def test_task_maintenance_fails_stale_tasks() -> None:
    stale_pending = SimpleNamespace(
        job_uuid="job-pending",
        state=None,
        progress=30,
        error=None,
        error_type=None,
        code=None,
        finished_at=None,
        updated_at=None,
    )
    stale_progress = SimpleNamespace(
        job_uuid="job-progress",
        state=None,
        progress=60,
        error=None,
        error_type=None,
        code=None,
        finished_at=None,
        updated_at=None,
    )
    repository = Mock()
    repository.list_stale_pending.return_value = [stale_pending]
    repository.list_stale_progress.return_value = [stale_progress]
    service = JobMaintenanceService(repository=repository)
    db = Mock()

    with patch("app.modules.jobs.maintenance_service.sync_job_service.finalize_failure") as fail:
        assert service.fail_stale_pending(db) == 1
        assert service.fail_stale_progress(db) == 1

    assert fail.call_count == 2
    assert fail.call_args_list[0].args[1] == "job-pending"
    assert fail.call_args_list[1].args[1] == "job-progress"


def test_task_maintenance_deletes_orphan_upload_file_and_row() -> None:
    repository = Mock()
    storage = Mock()
    storage.delete.return_value = True
    service = JobMaintenanceService(repository=repository, storage=storage)
    db = Mock()

    upload = SimpleNamespace(
        storage_key="scores/orphan.png",
        created_at=utc_now_naive() - timedelta(days=2),
    )
    repository.list_orphan_uploads.return_value = [upload]

    with patch(
        "app.modules.jobs.maintenance_service.settings.ORPHAN_UPLOAD_TTL_SECONDS",
        86400,
    ):
        deleted = service.cleanup_orphan_uploads(db)

    assert deleted == 1
    storage.delete.assert_called_once_with("scores/orphan.png")
    db.delete.assert_called_once_with(upload)
    db.commit.assert_called_once()


@pytest.mark.asyncio
async def test_task_submission_marks_dispatch_failure() -> None:
    service = JobSubmissionService()
    request = SimpleNamespace(file_ids=["abc"], options={}, idempotency_key=None)
    current_user = SimpleNamespace(id=5)

    with patch.object(service, "_ensure_uploads_exist") as ensure_mock:
        with patch.object(service, "_create_pending_job") as create_mock:
            with patch.object(
                service,
                "_dispatch",
                side_effect=RuntimeError("broker publish failed"),
            ) as dispatch_mock:
                with patch.object(service, "_mark_dispatch_failure") as mark_mock:
                    with pytest.raises(Exception) as context:
                        await service.submit(current_user, request)

    ensure_mock.assert_called_once_with(5, ["abc"])
    create_mock.assert_called_once()
    assert dispatch_mock.call_args.args[1] == ["abc"]
    assert dispatch_mock.call_args.args[2] == request.options
    mark_mock.assert_called_once()
    assert context.value.code == ErrorCode.EXTERNAL_SERVICE_ERROR


@pytest.mark.asyncio
async def test_task_submission_reuses_existing_idempotency_key() -> None:
    service = JobSubmissionService()
    request = SimpleNamespace(
        file_ids=["abc"],
        options={},
        idempotency_key="submission-key-1",
    )
    current_user = SimpleNamespace(id=5)

    with patch.object(
        service,
        "_existing_job_uuid",
        return_value="existing-task",
    ) as existing_mock:
        with patch.object(service, "_ensure_uploads_exist") as ensure_mock:
            result = await service.submit(current_user, request)

    assert result == {"job_id": "existing-task", "count": 1}
    existing_mock.assert_called_once_with(5, "submission-key-1")
    ensure_mock.assert_not_called()


def test_task_execution_resolves_file_ids_inside_worker() -> None:
    storage = Mock()
    storage.resolve_score_uploads.return_value = ["C:/worker/cache/score.png"]
    service = JobExecutionService(storage=storage)

    assert service._resolve_input_paths(["abc123"]) == ["C:/worker/cache/score.png"]
    storage.resolve_score_uploads.assert_called_once_with(["abc123"])


def test_task_submission_rejects_upload_owned_by_another_user() -> None:
    service = JobSubmissionService(storage=Mock())
    sync_db = Mock()
    upload = SimpleNamespace(uploader_user_id=99)

    with patch("app.db.worker_session.get_db_session", return_value=sync_db):
        with patch.object(sync_job_service.repository, "get_upload_by_sha256", return_value=upload):
            with pytest.raises(ResourceNotFoundException) as context:
                service._ensure_uploads_exist(5, ["abc"])

    assert context.value.code == ErrorCode.FILE_NOT_FOUND
    sync_db.close.assert_called_once()


@pytest.mark.asyncio
async def test_delete_uploaded_file_rejects_non_owner() -> None:
    repository = Mock()
    repository.get_upload_by_filename = AsyncMock(
        return_value=SimpleNamespace(id=1, uploader_user_id=99)
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
    repository.get_upload_by_filename = AsyncMock(
        return_value=SimpleNamespace(id=7, uploader_user_id=1, storage_key="scores/owned.png")
    )
    repository.delete_upload_by_id = AsyncMock()
    service = FilesService(repository=repository)
    db = AsyncMock()
    current_user = SimpleNamespace(id=1)

    with tempfile.TemporaryDirectory() as temp_dir:
        scores_dir = os.path.join(temp_dir, "scores")
        os.makedirs(scores_dir, exist_ok=True)
        file_path = os.path.join(scores_dir, "owned.png")
        with open(file_path, "wb") as file_handle:
            file_handle.write(b"png")

        storage = LocalFileStorage(storage_root=temp_dir)
        service = FilesService(repository=repository, storage=storage)
        result = await service.delete_uploaded_file(db, current_user, "owned.png")

    assert result == {"filename": "owned.png"}
    repository.delete_upload_by_id.assert_awaited_once_with(db, 7)
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
async def test_practice_service_rejects_missing_canonical_revision_artifact() -> None:
    access_policy = Mock()
    access_policy.authorize = AsyncMock(return_value=SimpleNamespace(
        score=SimpleNamespace(id=101, score_uuid="score-1"),
        revision=SimpleNamespace(id=201, revision_uuid="revision-1"),
        origin=AccessOrigin.OWNER,
        grant=None,
    ))
    score_repository = Mock()
    score_repository.canonical_artifact = AsyncMock(return_value=None)
    service = PracticeService(
        access_policy=access_policy,
        score_repository=score_repository,
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
    access_policy.authorize = AsyncMock(return_value=SimpleNamespace(
        score=SimpleNamespace(id=101, score_uuid="score-1"),
        revision=SimpleNamespace(id=201, revision_uuid="revision-1"),
        origin=AccessOrigin.SHARE,
        grant=SimpleNamespace(id=301),
    ))
    score_repository = Mock()
    score_repository.canonical_artifact = AsyncMock(
        return_value=SimpleNamespace(storage_key="scores/score-1/revisions/revision-1/score.musicxml")
    )
    storage = Mock()
    storage.local_path.return_value = "C:/tmp/final.xml"
    storage.materialize_to_local.return_value = "C:/tmp/final.xml"
    service = PracticeService(
        repository=repository,
        runtime_registry=runtime_registry,
        access_policy=access_policy,
        score_repository=score_repository,
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
        share_token="share-1",
    )

    assert result == {
        "session_id": "session-1",
        "state": PracticeSessionState.CREATED.value,
        "ws_url": "/api/v1/practice/sessions/session-1/stream",
    }
    runtime_registry.register.assert_called_once()
    created_session = repository.create_session.await_args.args[1]
    assert created_session.revision_id == 201
    assert created_session.share_grant_id == 301


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
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        started_at=None,
        finished_at=None,
        last_beat_position=None,
        last_confidence=None,
        report_status=PracticeReportStatus.NOT_REQUESTED,
        report_payload=None,
    )
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    repository.save_session = AsyncMock(side_effect=lambda _db, saved_session: saved_session)
    service = PracticeService(repository=repository)
    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, _identity: (
        SimpleNamespace(score_uuid="score-1")
        if model.__name__ == "Score"
        else SimpleNamespace(revision_uuid="revision-1")
    ))

    paused = await service.pause_session(db, "session-1", user_id=1)
    assert paused["state"] == PracticeSessionState.PAUSED.value

    resumed = await service.resume_session(db, "session-1", user_id=1)
    assert resumed["state"] == PracticeSessionState.STREAMING.value
    assert session.started_at is not None

    finished = await service.finish_session(db, "session-1", user_id=1)
    assert finished["state"] == PracticeSessionState.FINISHED.value
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
        "score_completed": False,
        "audio_active": True,
        "input_rms": 0.04,
        "input_peak": 0.1,
        "match_state": "matched",
    }

    await service.persist_alignment(AsyncMock(), "session-1", alignment)

    assert session.last_beat_position == 12.5
    assert session.last_confidence == 0.95


@pytest.mark.asyncio
async def test_practice_service_request_report_persists_structured_payload() -> None:
    repository = Mock()
    session = SimpleNamespace(
        session_uuid="session-1",
        user_id=1,
        state=PracticeSessionState.FINISHED,
        access_origin=AccessOrigin.OWNER,
        started_at=None,
        finished_at=None,
        last_beat_position=18.5,
        last_confidence=0.88,
        report_status=PracticeReportStatus.NOT_REQUESTED,
        report_payload=None,
        error=None,
    )
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    repository.save_report = AsyncMock(side_effect=lambda _db, saved_session: saved_session)
    service = PracticeService(repository=repository)

    result = await service.request_report(AsyncMock(), "session-1", user_id=1)

    assert result["report_status"] == PracticeReportStatus.READY.value
    assert result["report_payload"] is not None
    assert result["report_payload"]["metrics"]["confidence_label"] == "Strong"
    assert session.report_status == PracticeReportStatus.READY
    assert session.report_payload is not None
    assert repository.save_report.await_count == 2


@pytest.mark.asyncio
async def test_practice_service_get_report_parses_existing_payload() -> None:
    repository = Mock()
    session = SimpleNamespace(
        session_uuid="session-1",
        user_id=1,
        report_status=PracticeReportStatus.READY,
        report_payload='{"summary":"done","metrics":{"state":"FINISHED"},"recommendations":["keep going"]}',
    )
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    service = PracticeService(repository=repository)

    result = await service.get_report(AsyncMock(), "session-1", user_id=1)

    assert result == {
        "session_id": "session-1",
        "report_status": PracticeReportStatus.READY.value,
        "report_payload": {
            "summary": "done",
            "metrics": {"state": "FINISHED"},
            "recommendations": ["keep going"],
        },
    }
