from __future__ import annotations

import os
import tempfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.processing.engines.matchmaker_live import AlignmentUpdate
from app.db.models.practice import PracticeReportStatus, PracticeSessionState, PracticeSourceType
from app.modules.files.service import FilesService
from app.modules.practice.service import PracticeService
from app.modules.tasks.service import TaskService
from app.modules.tasks.worker_service import SyncTaskService
from app.shared.constants import ErrorCode


@pytest.mark.asyncio
async def test_get_task_raises_not_found_when_repository_returns_none() -> None:
    repository = Mock()
    repository.get_task_by_uuid = AsyncMock(return_value=None)
    service = TaskService(repository=repository)

    with pytest.raises(ResourceNotFoundException) as context:
        await service.get_task(AsyncMock(), "missing-task")

    assert context.value.code == ErrorCode.TASK_NOT_FOUND


@pytest.mark.asyncio
async def test_update_task_rejects_non_owner() -> None:
    repository = Mock()
    service = TaskService(repository=repository)
    db = AsyncMock()
    task = SimpleNamespace(user_id=1, title="Old", difficulty="easy")
    service.get_task = AsyncMock(return_value=task)

    with pytest.raises(UnauthorizedException) as context:
        await service.update_task(db, "task-1", user_id=2, title="New")

    assert context.value.code == ErrorCode.NO_EDIT_ACCESS
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_batch_delete_rejects_empty_task_ids() -> None:
    repository = Mock()
    service = TaskService(repository=repository)

    with pytest.raises(ValidationException) as context:
        await service.batch_delete(AsyncMock(), [], user_id=1)

    assert context.value.code == ErrorCode.NO_TASK_IDS


@pytest.mark.asyncio
async def test_batch_delete_returns_expected_counts() -> None:
    repository = Mock()
    repository.get_tasks_by_uuids_for_user = AsyncMock(
        return_value=[
            SimpleNamespace(id=1, task_uuid="task-1", state="SUCCESS"),
            SimpleNamespace(id=2, task_uuid="task-2", state="PROGRESS"),
        ]
    )
    repository.get_share_ids_for_tasks = AsyncMock(return_value=[10, 11])
    repository.delete_task_graph = AsyncMock()
    service = TaskService(repository=repository)
    service._cleanup_task_files = Mock()
    db = AsyncMock()

    result = await service.batch_delete(db, ["task-1", "task-2", "task-3"], user_id=1)

    assert result == {"deleted_count": 1, "skipped_running": 1, "not_found": 1}
    service._cleanup_task_files.assert_called_once_with("task-1")
    repository.get_share_ids_for_tasks.assert_awaited_once_with(db, [1])
    repository.delete_task_graph.assert_awaited_once_with(db, [1], share_ids=[10, 11])
    db.commit.assert_awaited_once()


def test_allowed_file_accepts_supported_extensions() -> None:
    service = FilesService(repository=Mock())

    assert service.allowed_file("score.png") is True
    assert service.allowed_file("score.TIFF") is True
    assert service.allowed_file("score.pdf") is False
    assert service.allowed_file("score") is False


def test_preview_file_raises_not_found_for_missing_file() -> None:
    service = FilesService(repository=Mock())

    with patch("app.modules.files.service.settings.UPLOAD_FOLDER", "C:/missing-root"):
        with pytest.raises(ResourceNotFoundException) as context:
            service.preview_file("missing.png")

    assert context.value.code == ErrorCode.FILE_NOT_FOUND


@pytest.mark.asyncio
async def test_delete_uploaded_file_rejects_non_owner() -> None:
    repository = Mock()
    repository.get_upload_by_stored_filename = AsyncMock(
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
    repository.get_upload_by_stored_filename = AsyncMock(
        return_value=SimpleNamespace(id=7, uploader_user_id=1)
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

        with patch("app.modules.files.service.settings.UPLOAD_FOLDER", temp_dir):
            result = await service.delete_uploaded_file(db, current_user, "owned.png")

    assert result == {"filename": "owned.png"}
    repository.delete_upload_by_id.assert_awaited_once_with(db, 7)
    db.commit.assert_awaited_once()


def test_worker_service_reset_session_state_rolls_back_failed_commit() -> None:
    db = Mock()
    db.commit.side_effect = RuntimeError("stale transaction")

    SyncTaskService._reset_session_state(db)

    db.expire_all.assert_called_once_with()
    db.commit.assert_called_once_with()
    db.rollback.assert_called_once_with()


@pytest.mark.asyncio
async def test_practice_service_create_session_rejects_missing_task() -> None:
    repository = Mock()
    repository.get_task_by_uuid = AsyncMock(return_value=None)
    service = PracticeService(repository=repository)

    with pytest.raises(ResourceNotFoundException) as context:
        await service.create_session(
            AsyncMock(),
            task_uuid="missing-task",
            user_id=1,
            source="final",
            sample_rate=16000,
            channels=1,
            frame_format="pcm_s16le",
        )

    assert context.value.code == ErrorCode.TASK_NOT_FOUND


@pytest.mark.asyncio
async def test_practice_service_create_session_allows_valid_share_token_access() -> None:
    repository = Mock()
    repository.get_task_by_uuid = AsyncMock(
        return_value=SimpleNamespace(id=101, task_uuid="task-1", user_id=1)
    )
    repository.get_share_by_token = AsyncMock(
        return_value=SimpleNamespace(task_id=101, revoked_at=None, expires_at=None)
    )
    repository.get_task_file_by_kind = AsyncMock(
        return_value=SimpleNamespace(path="output/task-1/final.xml")
    )
    repository.create_session = AsyncMock(
        return_value=SimpleNamespace(
            session_uuid="session-1",
            state=PracticeSessionState.CREATED,
        )
    )
    runtime_registry = Mock()
    service = PracticeService(
        repository=repository,
        runtime_registry=runtime_registry,
    )

    result = await service.create_session(
        AsyncMock(),
        task_uuid="task-1",
        user_id=2,
        source="final",
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


@pytest.mark.asyncio
async def test_practice_service_pause_resume_and_finish_follow_valid_transitions() -> None:
    repository = Mock()
    session = SimpleNamespace(
        session_uuid="session-1",
        user_id=1,
        task_id=101,
        share_token=None,
        source_type=PracticeSourceType.final,
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
    repository.get_task_by_id = AsyncMock(return_value=SimpleNamespace(task_uuid="task-1"))
    repository.save_session = AsyncMock(side_effect=lambda _db, saved_session: saved_session)
    service = PracticeService(repository=repository)
    db = AsyncMock()

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
        "timestamp_ms": 320,
        "score_completed": False,
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
        source_type=PracticeSourceType.final,
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
