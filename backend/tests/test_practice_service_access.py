import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.exceptions import (
    ExternalServiceException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.models.practice import PracticeReportStatus, PracticeSessionState
from app.modules.practice.service import PracticeService
from app.shared.constants import ErrorCode


def _session(
    *,
    user_id: int = 7,
    state: PracticeSessionState = PracticeSessionState.CREATED,
) -> SimpleNamespace:
    return SimpleNamespace(
        session_uuid="session-1",
        user_id=user_id,
        score_id=11,
        revision_id=12,
        state=state,
        started_at=None,
        finished_at=None,
        report_status=PracticeReportStatus.NOT_REQUESTED,
        report_payload=None,
        error=None,
        access_origin="OWNER",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        last_beat_position=None,
        last_confidence=None,
    )


def _service_with_session(session: object | None) -> tuple[PracticeService, Mock, Mock, Mock]:
    repository = Mock()
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    repository.save_session = AsyncMock(side_effect=lambda _db, value: value)
    runtime_registry = Mock()
    library_service = Mock()
    library_service.mark_practiced = AsyncMock()
    read_model = Mock()
    read_model.to_session_detail = AsyncMock(side_effect=lambda _db, value: {"state": value.state})
    service = PracticeService(
        repository=repository,
        runtime_registry=runtime_registry,
        library_service=library_service,
        read_model=read_model,
    )
    return service, repository, runtime_registry, library_service


@pytest.mark.asyncio
async def test_session_access_distinguishes_missing_and_other_users() -> None:
    missing_service, _repository, _runtime, _library = _service_with_session(None)

    with pytest.raises(ResourceNotFoundException) as missing_error:
        await missing_service.require_session_access(Mock(), "missing-session", 7)

    assert missing_error.value.code == ErrorCode.PRACTICE_SESSION_NOT_FOUND

    foreign_service, _repository, _runtime, _library = _service_with_session(_session())
    with pytest.raises(UnauthorizedException) as access_error:
        await foreign_service.require_session_access(Mock(), "session-1", 8)

    assert access_error.value.code == ErrorCode.NO_PRACTICE_ACCESS
    assert access_error.value.details == {"session_id": "session-1"}


@pytest.mark.asyncio
async def test_cached_runtime_still_requires_session_ownership() -> None:
    service, _repository, runtime_registry, _library = _service_with_session(_session())
    runtime_registry.get.return_value = SimpleNamespace()

    with pytest.raises(UnauthorizedException):
        await service.prepare_stream_runtime(Mock(), "session-1", 8)

    runtime_registry.get.assert_not_called()


@pytest.mark.asyncio
async def test_stream_lifecycle_updates_state_and_runtime() -> None:
    session = _session()
    service, repository, runtime_registry, _library = _service_with_session(session)
    runtime = SimpleNamespace(state="CREATED")
    runtime_registry.get.return_value = runtime
    database = Mock()

    started = await service.start_session_stream(database, "session-1", 7)
    paused = await service.pause_session(database, "session-1", 7)
    resumed = await service.resume_session(database, "session-1", 7)

    assert started == {"state": PracticeSessionState.STREAMING}
    assert paused == {"state": PracticeSessionState.PAUSED}
    assert resumed == {"state": PracticeSessionState.STREAMING}
    assert session.started_at is not None
    assert runtime.state == PracticeSessionState.STREAMING.value
    assert repository.save_session.await_count == 3


@pytest.mark.asyncio
async def test_lifecycle_rejects_invalid_state_transitions() -> None:
    session = _session(state=PracticeSessionState.FINISHED)
    service, repository, _runtime, _library = _service_with_session(session)

    with pytest.raises(ValidationException) as start_error:
        await service.start_session_stream(Mock(), "session-1", 7)
    with pytest.raises(ValidationException) as pause_error:
        await service.pause_session(Mock(), "session-1", 7)
    with pytest.raises(ValidationException) as resume_error:
        await service.resume_session(Mock(), "session-1", 7)
    with pytest.raises(ValidationException) as finish_error:
        await service.finish_session(Mock(), "session-1", 7)

    for error in (start_error, pause_error, resume_error, finish_error):
        assert error.value.code == ErrorCode.PRACTICE_SESSION_INVALID_STATE
        assert error.value.details == {"field": "state"}
    repository.save_session.assert_not_awaited()


@pytest.mark.asyncio
async def test_finish_marks_practice_and_releases_its_runtime() -> None:
    session = _session(state=PracticeSessionState.PAUSED)
    service, repository, runtime_registry, library_service = _service_with_session(session)
    database = Mock()
    database.commit = AsyncMock()

    result = await service.finish_session(database, "session-1", 7)

    assert result == {"state": PracticeSessionState.FINISHED}
    assert session.finished_at is not None
    repository.save_session.assert_awaited_once_with(database, session)
    library_service.mark_practiced.assert_awaited_once_with(database, 7, 11)
    database.commit.assert_awaited_once()
    runtime_registry.release.assert_called_once_with("session-1")


@pytest.mark.asyncio
async def test_request_report_persists_a_ready_payload_for_finished_sessions() -> None:
    session = _session(state=PracticeSessionState.FINISHED)
    service, repository, _runtime, _library = _service_with_session(session)
    report_builder = Mock()
    report_builder.build.return_value = {"summary": "Strong timing"}
    service.report_builder = report_builder
    repository.save_report = AsyncMock(side_effect=lambda _db, value: value)
    read_model = Mock()
    read_model.to_report_result = Mock(
        side_effect=lambda value: {
            "status": value.report_status,
            "payload": json.loads(value.report_payload),
        }
    )
    service.read_model = read_model

    report = await service.request_report(Mock(), "session-1", 7)

    assert report == {
        "status": PracticeReportStatus.READY,
        "payload": {"summary": "Strong timing"},
    }
    assert session.report_status == PracticeReportStatus.READY
    assert session.error is None
    assert repository.save_report.await_count == 2


@pytest.mark.asyncio
async def test_request_report_records_failure_without_exposing_the_engine_error() -> None:
    session = _session(state=PracticeSessionState.FINISHED)
    service, repository, _runtime, _library = _service_with_session(session)
    service.report_builder = Mock()
    service.report_builder.build.side_effect = RuntimeError("internal report engine error")
    repository.save_report = AsyncMock(side_effect=lambda _db, value: value)

    with pytest.raises(ValidationException) as error:
        await service.request_report(Mock(), "session-1", 7)

    assert error.value.code == ErrorCode.PRACTICE_REPORT_FAILED
    assert error.value.details == {"field": "report"}
    assert session.report_status == PracticeReportStatus.FAILED
    assert json.loads(session.report_payload) == {
        "summary": "Practice report generation failed."
    }
    assert session.error == "internal report engine error"
    repository.save_report.await_count == 2


@pytest.mark.asyncio
async def test_persist_alignment_updates_only_an_existing_session() -> None:
    session = _session()
    service, repository, _runtime, _library = _service_with_session(session)
    alignment = {"beat_position": 8.5, "confidence": 0.91}

    await service.persist_alignment(Mock(), "session-1", alignment)

    assert session.last_beat_position == 8.5
    assert session.last_confidence == 0.91
    repository.save_session.assert_awaited_once()

    missing_service, _repository, _runtime, _library = _service_with_session(None)
    with pytest.raises(ResourceNotFoundException) as error:
        await missing_service.persist_alignment(Mock(), "missing-session", alignment)

    assert error.value.code == ErrorCode.PRACTICE_SESSION_NOT_FOUND


@pytest.mark.asyncio
async def test_create_session_requires_a_canonical_revision_source() -> None:
    repository = Mock()
    repository.create_session = AsyncMock(side_effect=lambda _db, value: value)
    access_policy = Mock()
    access_policy.authorize = AsyncMock(
        return_value=SimpleNamespace(
            score=SimpleNamespace(id=11),
            revision=SimpleNamespace(id=12),
            origin="OWNER",
            grant=None,
        )
    )
    asset_repository = Mock()
    asset_repository.canonical_source = AsyncMock(
        return_value=SimpleNamespace(storage_key="scores/score-1.musicxml")
    )
    service = PracticeService(
        repository=repository,
        access_policy=access_policy,
        asset_repository=asset_repository,
    )

    summary = await service.create_session(
        Mock(),
        score_uuid="score-1",
        user_id=7,
        revision_uuid="revision-1",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
    )

    assert summary.state == PracticeSessionState.CREATED
    assert summary.ws_url == f"/api/v1/practice/sessions/{summary.session_id}/stream"
    created_session = repository.create_session.await_args.args[1]
    assert created_session.score_id == 11
    assert created_session.revision_id == 12
    assert created_session.user_id == 7
    assert created_session.sample_rate == 16000

    asset_repository.canonical_source = AsyncMock(return_value=None)
    with pytest.raises(ResourceNotFoundException) as error:
        await service.create_session(
            Mock(),
            score_uuid="score-1",
            user_id=7,
            revision_uuid="revision-1",
            sample_rate=16000,
            channels=1,
            frame_format="pcm_s16le",
        )

    assert error.value.code == ErrorCode.FILE_NOT_FOUND


@pytest.mark.asyncio
async def test_prepare_runtime_registers_the_authorized_session() -> None:
    session = _session()
    service, repository, runtime_registry, _library = _service_with_session(session)
    database = Mock()
    database.get = AsyncMock(
        side_effect=[
            SimpleNamespace(score_uuid="score-1"),
            SimpleNamespace(id=12, revision_uuid="revision-1"),
        ]
    )
    service.asset_repository = Mock()
    service.asset_repository.canonical_source = AsyncMock(
        return_value=SimpleNamespace(storage_key="scores/score-1.musicxml")
    )
    service.storage = Mock()
    service.storage.local_path.return_value = "/cache/score-1.musicxml"
    service.storage.materialize_to_local.return_value = "/materialized/score-1.musicxml"
    runtime = SimpleNamespace()
    runtime_registry.get.return_value = None
    runtime_registry.register.return_value = runtime

    assert await service.prepare_stream_runtime(database, "session-1", 7) is runtime

    repository.get_session_by_uuid.assert_awaited_once_with(database, "session-1")
    runtime_registry.register.assert_called_once_with(
        session_id="session-1",
        task_id="score-1",
        state="CREATED",
        score_file_path="/materialized/score-1.musicxml",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
    )


@pytest.mark.asyncio
async def test_prepare_runtime_rejects_terminal_sessions_and_persists_registration_failures() -> None:
    terminal_service, _repository, terminal_runtime, _library = _service_with_session(
        _session(state=PracticeSessionState.FINISHED)
    )
    terminal_runtime.get.return_value = None

    with pytest.raises(ValidationException) as terminal_error:
        await terminal_service.prepare_stream_runtime(Mock(), "session-1", 7)

    assert terminal_error.value.code == ErrorCode.PRACTICE_SESSION_INVALID_STATE

    session = _session()
    service, repository, runtime_registry, _library = _service_with_session(session)
    database = Mock()
    database.get = AsyncMock(
        side_effect=[
            SimpleNamespace(score_uuid="score-1"),
            SimpleNamespace(id=12, revision_uuid="revision-1"),
        ]
    )
    service.asset_repository = Mock()
    service.asset_repository.canonical_source = AsyncMock(
        return_value=SimpleNamespace(storage_key="scores/score-1.musicxml")
    )
    service.storage = Mock()
    service.storage.local_path.return_value = "/cache/score-1.musicxml"
    service.storage.materialize_to_local.return_value = "/materialized/score-1.musicxml"
    runtime_registry.get.return_value = None
    runtime_registry.register.side_effect = RuntimeError("alignment engine unavailable")

    with pytest.raises(ExternalServiceException) as registration_error:
        await service.prepare_stream_runtime(database, "session-1", 7)

    assert registration_error.value.code == ErrorCode.PRACTICE_ALIGNMENT_FAILED
    assert session.state == PracticeSessionState.FAILED
    assert session.error == "alignment engine unavailable"
    repository.save_session.assert_awaited_once_with(database, session)
