import json
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest.mock import ANY, AsyncMock, Mock

import pytest

from app.core.exceptions import (
    ExternalServiceException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.models.practice import (
    PracticeAttemptCompletionStatus,
    PracticeAttemptResolutionReason,
    PracticeAttemptResult,
    PracticeEvaluationProfile,
    PracticeInputSource,
    PracticeProgressionMode,
    PracticeRealtimeGuidance,
    PracticeReplayArtifactKind,
    PracticeSessionCompletionReason,
    PracticeSessionSummaryStatus,
    PracticeSessionState,
)
from app.modules.practice.service import PracticeService
from app.modules.practice.schemas import PracticeSessionScope
from app.modules.practice.session_config import PracticeSessionPreset
from app.modules.score_access.policy import ScoreAction
from app.processing.engines.practice_alignment.target_catalog import (
    PracticeTargetCatalog,
    PracticeTargetCatalogEntry,
)
from app.processing.engines.practice_alignment.attempt_assembler import (
    PracticeAttemptOutcome,
    ResolvedPracticeAttempt,
)
from app.processing.engines.practice_alignment.attempt_lifecycle import PracticeAttemptSnapshot
from app.processing.engines.practice_alignment.contracts import AlignmentUpdate
from app.processing.engines.practice_alignment.expected_event_evaluator import PracticeEventEvaluation
from app.processing.engines.practice_alignment.follow_policy import (
    AlignmentAction,
    AlignmentReason,
    PracticeExperienceState,
    PracticeScopeInvalidRange,
    PracticeScopeTargetNotFound,
)
from app.shared.constants import ErrorCode


def _session(
    *,
    user_id: int = 7,
    state: PracticeSessionState = PracticeSessionState.CREATED,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        session_uuid="session-1",
        user_id=user_id,
        score_id=11,
        revision_id=12,
        state=state,
        progression_mode=PracticeProgressionMode.WAIT_FOR_NOTE,
        realtime_guidance=PracticeRealtimeGuidance.GUIDED,
        evaluation_profile=PracticeEvaluationProfile.LEARNING,
        input_source=PracticeInputSource.MICROPHONE,
        scope_start_expected_group_id=None,
        scope_end_expected_group_id=None,
        scope_start_measure_number=None,
        scope_end_measure_number=None,
        started_at=None,
        finished_at=None,
        summary_status=PracticeSessionSummaryStatus.NOT_REQUESTED,
        summary_payload=None,
        error=None,
        access_origin="OWNER",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        last_beat_position=None,
        last_confidence=None,
        completion_reason=None,
    )


def _service_with_session(session: object | None) -> tuple[PracticeService, Mock, Mock, Mock]:
    repository = Mock()
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    repository.save_session = AsyncMock(side_effect=lambda _db, value: value)
    repository.list_attempts_for_session = AsyncMock(return_value=[])
    repository.get_attempt_by_uid = AsyncMock(return_value=None)
    repository.create_attempt_if_absent = AsyncMock(return_value=True)
    repository.has_replay_artifact_for_session = AsyncMock(return_value=False)
    runtime_registry = Mock()
    runtime_registry.get.return_value = None
    library_service = Mock()
    library_service.mark_practiced = AsyncMock()
    read_model = Mock()
    read_model.to_session_detail = AsyncMock(
        side_effect=lambda _db, value, **_kwargs: {"state": value.state}
    )
    service = PracticeService(
        repository=repository,
        runtime_registry=runtime_registry,
        library_service=library_service,
        read_model=read_model,
    )
    return service, repository, runtime_registry, library_service


@pytest.mark.asyncio
async def test_list_saved_performances_returns_saved_replay_entries() -> None:
    saved_session = _session(state=PracticeSessionState.FINISHED)
    saved_session.session_uuid = "saved-session"
    saved_session.evaluation_profile = PracticeEvaluationProfile.PERFORMANCE
    saved_session.progression_mode = PracticeProgressionMode.CONTINUOUS
    saved_session.realtime_guidance = PracticeRealtimeGuidance.STATUS_ONLY
    saved_session.completion_reason = PracticeSessionCompletionReason.STOPPED_BY_USER
    saved_session.started_at = datetime(2026, 9, 5, 10, 0, 0)
    saved_session.finished_at = datetime(2026, 9, 5, 10, 1, 0)
    saved_session.summary_status = PracticeSessionSummaryStatus.READY
    saved_session.summary_payload = json.dumps(
        {
            "summary": "No durable evaluation.",
            "metrics": {"expected_outcome_count": 0},
            "recommendations": [],
            "targets": [],
            "difficult_measures": [],
        }
    )

    artifact = SimpleNamespace(
        artifact_uuid="artifact-1",
        kind=PracticeReplayArtifactKind.AUDIO_RECORDING,
        duration_ms=61000,
        created_at=datetime(2026, 9, 5, 10, 2, 0),
    )

    repository = Mock()
    repository.list_saved_performances_for_score_user = AsyncMock(
        return_value=[(saved_session, artifact)]
    )
    access_policy = Mock()
    access_policy.authorize = AsyncMock(
        return_value=SimpleNamespace(score=SimpleNamespace(id=11))
    )
    service = PracticeService(repository=repository, access_policy=access_policy)
    database = AsyncMock()
    database.get = AsyncMock(return_value=SimpleNamespace(revision_uuid="revision-1"))

    history = await service.list_saved_performances(
        database,
        "score-1",
        user_id=7,
    )

    assert [item.session_id for item in history] == ["saved-session"]
    assert history[0].artifact_id == "artifact-1"
    assert history[0].replay_duration_ms == 61000
    assert history[0].evaluation_available is False
    access_policy.authorize.assert_awaited_once_with(
        database,
        "score-1",
        ScoreAction.PRACTICE,
        user_id=7,
        revision_uuid=None,
    )
    repository.list_saved_performances_for_score_user.assert_awaited_once_with(
        database,
        score_id=11,
        user_id=7,
        limit=10,
    )


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
async def test_list_practice_targets_uses_practice_access_and_score_timeline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _repository, _runtime, _library = _service_with_session(None)
    service.access_policy = Mock()
    service.access_policy.authorize = AsyncMock(
        return_value=SimpleNamespace(
            score=SimpleNamespace(id=11, score_uuid="score-1"),
            revision=SimpleNamespace(id=12, revision_uuid="revision-1"),
        )
    )
    service.asset_repository = Mock()
    service.asset_repository.canonical_source = AsyncMock(
        return_value=SimpleNamespace(storage_key="scores/score-1/revisions/revision-1/score.musicxml")
    )
    service.storage = Mock()
    service.storage.local_path.return_value = "/cache/score.musicxml"
    service.storage.materialize_to_local.return_value = "/materialized/score.musicxml"

    def catalog_from_musicxml(score_file_path: Path) -> PracticeTargetCatalog:
        assert score_file_path == Path("/materialized/score.musicxml")
        return PracticeTargetCatalog(
            targets=(
                PracticeTargetCatalogEntry(
                    index=0,
                    group_id="entry-1",
                    onset_beat=3.0,
                    event_ids=("event-1",),
                    render_note_ids=("note-1",),
                    pitches=("C4",),
                    measure_numbers=("2",),
                    staff_ids=("1",),
                    voice_ids=("1",),
                ),
            )
        )

    monkeypatch.setattr(
        "app.modules.practice.service.practice_target_catalog_from_musicxml",
        catalog_from_musicxml,
    )

    result = await service.list_practice_targets(Mock(), "score-1", 7, "revision-1")

    service.access_policy.authorize.assert_awaited_once_with(
        ANY,
        "score-1",
        ScoreAction.PRACTICE,
        user_id=7,
        revision_uuid="revision-1",
    )
    service.asset_repository.canonical_source.assert_awaited_once_with(ANY, 12)
    service.storage.local_path.assert_called_once_with(
        "scores/score-1/revisions/revision-1/score.musicxml"
    )
    assert result.model_dump() == {
        "score_id": "score-1",
        "revision_id": "revision-1",
        "targets": [
            {
                "index": 0,
                "group_id": "entry-1",
                "onset_beat": 3.0,
                "event_ids": ["event-1"],
                "render_note_ids": ["note-1"],
                "pitches": ["C4"],
                "measure_numbers": ["2"],
                "staff_ids": ["1"],
                "voice_ids": ["1"],
            }
        ],
    }


@pytest.mark.asyncio
async def test_list_practice_targets_converts_catalog_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _repository, _runtime, _library = _service_with_session(None)
    service.access_policy = Mock()
    service.access_policy.authorize = AsyncMock(
        return_value=SimpleNamespace(
            score=SimpleNamespace(id=11, score_uuid="score-1"),
            revision=SimpleNamespace(id=12, revision_uuid="revision-1"),
        )
    )
    service.asset_repository = Mock()
    service.asset_repository.canonical_source = AsyncMock(
        return_value=SimpleNamespace(storage_key="scores/score-1/revisions/revision-1/score.musicxml")
    )
    service.storage = Mock()
    service.storage.local_path.return_value = "/cache/score.musicxml"
    service.storage.materialize_to_local.return_value = "/materialized/score.musicxml"

    def fail_catalog(_score_file_path: str) -> PracticeTargetCatalog:
        raise RuntimeError("partitura unavailable")

    monkeypatch.setattr(
        "app.modules.practice.service.practice_target_catalog_from_musicxml",
        fail_catalog,
    )

    with pytest.raises(ExternalServiceException) as error:
        await service.list_practice_targets(Mock(), "score-1", 7, "revision-1")

    assert error.value.code == ErrorCode.PRACTICE_ALIGNMENT_FAILED


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
    runtime = SimpleNamespace(
        state="CREATED",
        reset_input_buffer=Mock(),
        finalize_pending_practice_attempt=Mock(return_value=[]),
    )
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
    runtime.reset_input_buffer.assert_called_once_with()
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
        await service.finish_session(
            Mock(),
            "session-1",
            7,
            completion_reason=PracticeSessionCompletionReason.STOPPED_BY_USER,
        )

    for error in (start_error, pause_error, resume_error, finish_error):
        assert error.value.code == ErrorCode.PRACTICE_SESSION_INVALID_STATE
        assert error.value.details == {"field": "state"}
    repository.save_session.assert_not_awaited()


@pytest.mark.asyncio
async def test_finish_marks_practice_and_releases_its_runtime() -> None:
    session = _session(state=PracticeSessionState.PAUSED)
    service, repository, runtime_registry, library_service = _service_with_session(session)
    service.summary_builder = Mock()
    service.summary_builder.build.return_value = {"summary": "Finished"}
    database = Mock()
    database.commit = AsyncMock()

    result = await service.finish_session(database, "session-1", 7)

    assert result == {"state": PracticeSessionState.FINISHED}
    assert session.finished_at is not None
    assert session.completion_reason == PracticeSessionCompletionReason.STOPPED_BY_USER
    assert session.summary_status == PracticeSessionSummaryStatus.PENDING
    assert session.summary_payload is None
    assert repository.save_session.await_count == 1


@pytest.mark.asyncio
async def test_scope_completion_finish_records_completion_reason() -> None:
    session = _session(state=PracticeSessionState.STREAMING)
    service, _repository, _runtime, _library = _service_with_session(session)
    service.summary_builder = Mock()
    service.summary_builder.build.return_value = {"summary": "Complete"}
    database = Mock()
    database.commit = AsyncMock()

    await service.finish_session(
        database,
        "session-1",
        7,
        completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
    )

    assert session.state == PracticeSessionState.FINISHED
    assert session.completion_reason == PracticeSessionCompletionReason.SCOPE_COMPLETED


@pytest.mark.asyncio
async def test_finish_is_idempotent_for_same_completion_reason() -> None:
    session = _session(state=PracticeSessionState.FINISHED)
    session.completion_reason = PracticeSessionCompletionReason.SCOPE_COMPLETED
    service, repository, runtime_registry, library_service = _service_with_session(session)

    result = await service.finish_session(
        Mock(),
        "session-1",
        7,
        completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
    )

    assert result == {"state": PracticeSessionState.FINISHED}
    repository.save_session.assert_not_awaited()
    runtime_registry.release.assert_not_called()
    library_service.mark_practiced.assert_not_awaited()


@pytest.mark.asyncio
async def test_active_stream_failure_marks_session_failed_and_releases_runtime() -> None:
    session = _session(state=PracticeSessionState.STREAMING)
    service, repository, runtime_registry, _library = _service_with_session(session)

    result = await service.fail_active_session_stream(
        Mock(),
        "session-1",
        7,
        reason="performance websocket disconnected before terminal boundary",
    )

    assert result == {"state": PracticeSessionState.FAILED}
    assert session.state == PracticeSessionState.FAILED
    assert session.error == "performance websocket disconnected before terminal boundary"
    assert session.finished_at is not None
    assert session.completion_reason is None
    repository.save_session.assert_awaited_once()
    runtime_registry.release.assert_called_once_with("session-1")


@pytest.mark.asyncio
async def test_build_summary_persists_a_ready_summary_payload() -> None:
    session = _session(state=PracticeSessionState.FINISHED)
    session.completion_reason = PracticeSessionCompletionReason.STOPPED_BY_USER
    service, repository, _runtime, _library = _service_with_session(session)
    summary_builder = Mock()
    summary_builder.build.return_value = {"summary": "Strong timing"}
    service.summary_builder = summary_builder
    database = Mock()
    database.commit = AsyncMock()

    await service.build_summary_for_finished_session(database, "session-1", 7)

    assert session.summary_status == PracticeSessionSummaryStatus.READY
    assert json.loads(session.summary_payload) == {"summary": "Strong timing"}
    assert session.error is None
    repository.list_attempts_for_session.assert_awaited_once_with(database, 1)
    repository.save_session.assert_awaited_once_with(database, session)


@pytest.mark.asyncio
async def test_build_summary_records_failure_without_reopening_finished_session() -> None:
    session = _session(state=PracticeSessionState.FINISHED)
    session.completion_reason = PracticeSessionCompletionReason.STOPPED_BY_USER
    service, repository, _runtime, _library = _service_with_session(session)
    service.summary_builder = Mock()
    service.summary_builder.build.side_effect = RuntimeError("internal summary builder error")
    database = Mock()
    database.commit = AsyncMock()

    result = await service.build_summary_for_finished_session(database, "session-1", 7)

    assert result == {"state": PracticeSessionState.FINISHED}
    assert session.state == PracticeSessionState.FINISHED
    assert session.summary_status == PracticeSessionSummaryStatus.FAILED
    assert json.loads(session.summary_payload) == {
        "summary": "Practice summary generation failed."
    }
    assert session.error == "internal summary builder error"
    repository.save_session.assert_awaited_once_with(database, session)


@pytest.mark.asyncio
async def test_persist_alignment_updates_only_an_existing_session() -> None:
    session = _session()
    service, repository, _runtime, _library = _service_with_session(session)
    alignment = cast(AlignmentUpdate, {"beat_position": 8.5, "confidence": 0.91})

    await service.persist_alignment(Mock(), "session-1", alignment)

    assert session.last_beat_position == 8.5
    assert session.last_confidence == 0.91
    repository.save_session.assert_awaited_once()

    missing_service, _repository, _runtime, _library = _service_with_session(None)
    with pytest.raises(ResourceNotFoundException) as error:
        await missing_service.persist_alignment(Mock(), "missing-session", alignment)

    assert error.value.code == ErrorCode.PRACTICE_SESSION_NOT_FOUND


def _resolved_attempt(
    *,
    result: str = "MATCH",
    action: AlignmentAction = "advance",
    reason: AlignmentReason = "stable_match",
    experience_state: PracticeExperienceState = "following",
) -> ResolvedPracticeAttempt:
    outcome = PracticeAttemptOutcome(
        snapshot=PracticeAttemptSnapshot(
            attempt_id="00000000-0000-4000-8000-000000000003",
            attempt_sequence=3,
            expected_group_id="entry-1",
            started_at_ms=100,
            state="resolved",
            resolved_at_ms=120,
        ),
        evaluation=PracticeEventEvaluation(
            expected_group_id="entry-1",
            result=result,
            matched_pitches=("E4", "G4", "B4") if result == "MATCH" else (),
            missing_pitches=(),
            extra_pitches=("C4",) if result == "MISMATCH" else (),
            confidence=1.0,
            evaluator_version="expected-event-v1",
        ),
        policy_profile_version="wait-for-note-v1",
    )
    return ResolvedPracticeAttempt(
        outcome=outcome,
        action=action,
        resolution_reason=reason,
        experience_state=experience_state,
        display_anchor={
            "beat": 4.0,
            "event_id": "event-4",
            "group_id": "entry-1",
            "render_note_ids": ["n2", "n3", "n4"],
        },
        measure_numbers=("2",),
        beat_position=4.0,
        confidence=1.0,
        timestamp_ms=120,
        validation_confidence=1.0,
        input_policy_confidence=1.0,
    )


@pytest.mark.asyncio
async def test_persist_practice_attempt_records_wait_for_note_outcome() -> None:
    session = _session(state=PracticeSessionState.STREAMING)
    session.progression_mode = PracticeProgressionMode.WAIT_FOR_NOTE
    session.realtime_guidance = PracticeRealtimeGuidance.GUIDED
    session.evaluation_profile = PracticeEvaluationProfile.LEARNING
    session.input_source = PracticeInputSource.MIDI
    service, repository, _runtime, _library = _service_with_session(session)
    repository.next_attempt_index = AsyncMock(return_value=3)
    repository.create_attempt_if_absent = AsyncMock(return_value=True)

    await service.persist_practice_attempt(Mock(), "session-1", _resolved_attempt())

    repository.create_attempt_if_absent.assert_awaited_once()
    attempt = repository.create_attempt_if_absent.await_args.args[1]
    assert attempt.attempt_index == 3
    assert attempt.result == PracticeAttemptResult.MATCH
    assert attempt.input_source == PracticeInputSource.MIDI
    assert attempt.evidence_profile == "MIDI_STRICT"
    assert attempt.correctness_scope == "symbolic_exact_notes"
    assert attempt.attempt_uid == "00000000-0000-4000-8000-000000000003"
    assert attempt.started_at_ms == 100
    assert attempt.resolved_at_ms == 120
    assert attempt.evaluator_version == "expected-event-v1"
    assert attempt.policy_profile_version == "wait-for-note-v1"
    assert attempt.completion_status == PracticeAttemptCompletionStatus.COMPLETED
    assert attempt.resolution_reason == PracticeAttemptResolutionReason.STABLE_MATCH
    assert attempt.render_note_ids == '["n2", "n3", "n4"]'
    assert attempt.measure_numbers == '["2"]'


@pytest.mark.asyncio
async def test_persist_practice_attempt_records_resolved_mismatch_outcome() -> None:
    session = _session(state=PracticeSessionState.STREAMING)
    session.progression_mode = PracticeProgressionMode.WAIT_FOR_NOTE
    session.realtime_guidance = PracticeRealtimeGuidance.GUIDED
    session.evaluation_profile = PracticeEvaluationProfile.LEARNING
    session.input_source = PracticeInputSource.MIDI
    service, repository, _runtime, _library = _service_with_session(session)
    repository.next_attempt_index = AsyncMock(return_value=3)
    repository.create_attempt_if_absent = AsyncMock(return_value=True)
    await service.persist_practice_attempt(
        Mock(),
        "session-1",
        _resolved_attempt(
            result="MISMATCH",
            action="hold",
            reason="entry_mismatch",
            experience_state="possible_wrong_note",
        ),
    )

    repository.create_attempt_if_absent.assert_awaited_once()
    attempt = repository.create_attempt_if_absent.await_args.args[1]
    assert attempt.attempt_index == 3
    assert attempt.action == "hold"
    assert attempt.result == PracticeAttemptResult.MISMATCH
    assert attempt.resolution_reason == PracticeAttemptResolutionReason.ENTRY_MISMATCH


@pytest.mark.asyncio
async def test_persist_practice_attempt_uses_idempotent_repository_boundary() -> None:
    session = _session(state=PracticeSessionState.STREAMING)
    service, repository, _runtime, _library = _service_with_session(session)
    repository.next_attempt_index = AsyncMock(return_value=3)
    repository.create_attempt_if_absent = AsyncMock(return_value=False)

    await service.persist_practice_attempt(Mock(), "session-1", _resolved_attempt())

    repository.next_attempt_index.assert_awaited_once_with(ANY, 1)
    repository.create_attempt_if_absent.assert_awaited_once()


@pytest.mark.asyncio
async def test_pause_session_finalizes_pending_runtime_attempt() -> None:
    session = _session(state=PracticeSessionState.STREAMING)
    service, repository, runtime_registry, _library = _service_with_session(session)
    runtime = SimpleNamespace(
        state="STREAMING",
        reset_input_buffer=Mock(),
        finalize_pending_practice_attempt=Mock(
            return_value=[
                _resolved_attempt(
                    result="PARTIAL",
                    action="hold",
                    reason="practice_paused",
                    experience_state="partially_matched",
                )
            ]
        ),
    )
    runtime_registry.get.return_value = runtime
    repository.next_attempt_index = AsyncMock(return_value=4)
    repository.create_attempt_if_absent = AsyncMock(return_value=True)

    await service.pause_session(Mock(), "session-1", 7)

    runtime.finalize_pending_practice_attempt.assert_called_once_with(reason="practice_paused")
    repository.create_attempt_if_absent.assert_awaited_once()
    attempt = repository.create_attempt_if_absent.await_args.args[1]
    assert attempt.attempt_index == 4
    assert attempt.result == PracticeAttemptResult.PARTIAL
    assert attempt.completion_status == PracticeAttemptCompletionStatus.INTERRUPTED
    assert attempt.resolution_reason == PracticeAttemptResolutionReason.PRACTICE_PAUSED


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

    session_start = await service.create_session(
        Mock(),
        score_uuid="score-1",
        user_id=7,
        revision_uuid="revision-1",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
    )

    assert session_start.state == PracticeSessionState.CREATED
    assert session_start.ws_url == f"/api/v1/practice/sessions/{session_start.session_id}/stream"
    created_session = repository.create_session.await_args.args[1]
    assert created_session.score_id == 11
    assert created_session.revision_id == 12
    assert created_session.user_id == 7
    assert created_session.sample_rate == 16000
    assert created_session.progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE
    assert created_session.realtime_guidance == PracticeRealtimeGuidance.GUIDED
    assert created_session.evaluation_profile == PracticeEvaluationProfile.LEARNING
    assert created_session.input_source == PracticeInputSource.MICROPHONE

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
        progression_mode=PracticeProgressionMode.WAIT_FOR_NOTE,
        realtime_guidance=PracticeRealtimeGuidance.GUIDED,
        evaluation_profile=PracticeEvaluationProfile.LEARNING,
        input_source=PracticeInputSource.MICROPHONE,
        start_expected_group_id=None,
        end_expected_group_id=None,
        runtime_kind="STEP_BY_STEP",
    )


@pytest.mark.asyncio
async def test_prepare_runtime_registers_fixed_clock_performance_session() -> None:
    session = _session()
    session.progression_mode = PracticeProgressionMode.CONTINUOUS
    session.realtime_guidance = PracticeRealtimeGuidance.STATUS_ONLY
    session.evaluation_profile = PracticeEvaluationProfile.PERFORMANCE
    session.input_source = PracticeInputSource.MIDI
    session.scope_start_expected_group_id = "entry-4"
    session.scope_end_expected_group_id = "entry-6"
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
        progression_mode=PracticeProgressionMode.CONTINUOUS,
        realtime_guidance=PracticeRealtimeGuidance.STATUS_ONLY,
        evaluation_profile=PracticeEvaluationProfile.PERFORMANCE,
        input_source=PracticeInputSource.MIDI,
        start_expected_group_id="entry-4",
        end_expected_group_id="entry-6",
        runtime_kind="FIXED_CLOCK_PERFORMANCE",
    )


@pytest.mark.asyncio
async def test_create_session_projects_step_by_step_preset_to_wait_for_note_learning() -> None:
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

    await service.create_session(
        Mock(),
        score_uuid="score-1",
        user_id=7,
        revision_uuid="revision-1",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        preset=PracticeSessionPreset.STEP_BY_STEP,
    )

    created_session = repository.create_session.await_args.args[1]
    assert created_session.progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE
    assert created_session.realtime_guidance == PracticeRealtimeGuidance.GUIDED
    assert created_session.evaluation_profile == PracticeEvaluationProfile.LEARNING


@pytest.mark.asyncio
async def test_create_session_persists_scoped_wait_for_note_target() -> None:
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

    await service.create_session(
        Mock(),
        score_uuid="score-1",
        user_id=7,
        revision_uuid="revision-1",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        preset=PracticeSessionPreset.STEP_BY_STEP,
        practice_scope=PracticeSessionScope(
            start_expected_group_id="entry-4",
            end_expected_group_id="entry-6",
            start_measure_number="12",
            end_measure_number="12",
        ),
    )

    created_session = repository.create_session.await_args.args[1]
    assert created_session.scope_start_expected_group_id == "entry-4"
    assert created_session.scope_end_expected_group_id == "entry-6"
    assert created_session.scope_start_measure_number == "12"
    assert created_session.scope_end_measure_number == "12"


@pytest.mark.asyncio
async def test_create_session_projects_continuous_play_to_fixed_clock_performance() -> None:
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

    await service.create_session(
        Mock(),
        score_uuid="score-1",
        user_id=7,
        revision_uuid="revision-1",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        preset=PracticeSessionPreset.CONTINUOUS_PLAY,
        input_source=PracticeInputSource.MICROPHONE,
        practice_scope=PracticeSessionScope(
            start_expected_group_id="entry-4",
            end_expected_group_id="entry-6",
            start_measure_number="12",
            end_measure_number="12",
        ),
    )

    created_session = repository.create_session.await_args.args[1]
    assert created_session.progression_mode == PracticeProgressionMode.CONTINUOUS
    assert created_session.realtime_guidance == PracticeRealtimeGuidance.STATUS_ONLY
    assert created_session.evaluation_profile == PracticeEvaluationProfile.PERFORMANCE
    assert created_session.input_source == PracticeInputSource.MICROPHONE
    assert created_session.scope_start_expected_group_id == "entry-4"
    assert created_session.scope_end_expected_group_id == "entry-6"


@pytest.mark.asyncio
async def test_create_session_does_not_accept_public_internal_policy_combinations() -> None:
    service = PracticeService()

    with pytest.raises(TypeError):
        await service.create_session(
            Mock(),
            score_uuid="score-1",
            user_id=7,
            revision_uuid="revision-1",
            sample_rate=16000,
            channels=1,
            frame_format="pcm_s16le",
            realtime_guidance=PracticeRealtimeGuidance.STATUS_ONLY,  # type: ignore[call-arg]
        )


@pytest.mark.asyncio
async def test_create_session_accepts_wait_for_note_midi_policy() -> None:
    repository = Mock()
    repository.create_session = AsyncMock(side_effect=lambda _db, session: session)
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

    await service.create_session(
        Mock(),
        score_uuid="score-1",
        user_id=7,
        revision_uuid="revision-1",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        preset=PracticeSessionPreset.STEP_BY_STEP,
        input_source=PracticeInputSource.MIDI,
    )

    created_session = repository.create_session.await_args.args[1]
    assert created_session.input_source == PracticeInputSource.MIDI


@pytest.mark.asyncio
async def test_create_session_accepts_continuous_play_midi_policy() -> None:
    repository = Mock()
    repository.create_session = AsyncMock(side_effect=lambda _db, session: session)
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

    await service.create_session(
        Mock(),
        score_uuid="score-1",
        user_id=7,
        revision_uuid="revision-1",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        preset=PracticeSessionPreset.CONTINUOUS_PLAY,
        input_source=PracticeInputSource.MIDI,
    )

    created_session = repository.create_session.await_args.args[1]
    assert created_session.progression_mode == PracticeProgressionMode.CONTINUOUS
    assert created_session.realtime_guidance == PracticeRealtimeGuidance.STATUS_ONLY
    assert created_session.evaluation_profile == PracticeEvaluationProfile.PERFORMANCE
    assert created_session.input_source == PracticeInputSource.MIDI


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


@pytest.mark.asyncio
async def test_prepare_runtime_reports_invalid_scoped_target_as_domain_error() -> None:
    session = _session()
    session.progression_mode = PracticeProgressionMode.WAIT_FOR_NOTE
    session.realtime_guidance = PracticeRealtimeGuidance.GUIDED
    session.evaluation_profile = PracticeEvaluationProfile.LEARNING
    session.scope_start_expected_group_id = "missing-entry"
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
    runtime_registry.register.side_effect = PracticeScopeTargetNotFound("missing-entry")

    with pytest.raises(ValidationException) as error:
        await service.prepare_stream_runtime(database, "session-1", 7)

    assert error.value.code == ErrorCode.PRACTICE_SCOPE_TARGET_NOT_FOUND
    assert error.value.details == {
        "field": "practice_scope",
        "expected_group_id": "missing-entry",
    }
    assert session.state == PracticeSessionState.FAILED
    assert session.error == "Unknown scoped practice start expected group: missing-entry"
    repository.save_session.assert_awaited_once_with(database, session)


@pytest.mark.asyncio
async def test_prepare_runtime_reports_invalid_scoped_range_as_domain_error() -> None:
    session = _session()
    session.progression_mode = PracticeProgressionMode.WAIT_FOR_NOTE
    session.realtime_guidance = PracticeRealtimeGuidance.GUIDED
    session.evaluation_profile = PracticeEvaluationProfile.LEARNING
    session.scope_start_expected_group_id = "entry-4"
    session.scope_end_expected_group_id = "entry-2"
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
    runtime_registry.register.side_effect = PracticeScopeInvalidRange("bad range")

    with pytest.raises(ValidationException) as error:
        await service.prepare_stream_runtime(database, "session-1", 7)

    assert error.value.code == ErrorCode.PRACTICE_SCOPE_INVALID
    assert error.value.details == {
        "field": "practice_scope",
        "start_expected_group_id": "entry-4",
        "end_expected_group_id": "entry-2",
    }
    assert session.state == PracticeSessionState.FAILED
    assert session.error == "bad range"
    repository.save_session.assert_awaited_once_with(database, session)
