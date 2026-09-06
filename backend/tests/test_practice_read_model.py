import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import ResourceNotFoundException
from app.db.models import Score
from app.db.models.practice import (
    PracticeEvaluationProfile,
    PracticeInputSource,
    PracticeProgressionMode,
    PracticeRealtimeGuidance,
    PracticeReplayArtifactKind,
    PracticeSessionCompletionReason,
    PracticeSessionSummaryStatus,
    PracticeSessionState,
)
from app.db.models.score_access import AccessOrigin
from app.modules.practice.read_model import PracticeReadModel
from app.modules.practice.session_config import PracticeSessionPreset
from app.shared.constants import ErrorCode


def _session(**overrides: object) -> SimpleNamespace:
    values = {
        "session_uuid": "session-1",
        "score_id": 11,
        "revision_id": 12,
        "access_origin": AccessOrigin.OWNER,
        "state": PracticeSessionState.CREATED,
        "progression_mode": PracticeProgressionMode.WAIT_FOR_NOTE,
        "realtime_guidance": PracticeRealtimeGuidance.GUIDED,
        "evaluation_profile": PracticeEvaluationProfile.LEARNING,
        "input_source": PracticeInputSource.MICROPHONE,
        "scope_start_expected_group_id": None,
        "scope_end_expected_group_id": None,
        "scope_start_measure_number": None,
        "scope_end_measure_number": None,
        "sample_rate": 16000,
        "channels": 1,
        "frame_format": "pcm_s16le",
        "started_at": None,
        "finished_at": None,
        "last_beat_position": None,
        "last_confidence": None,
        "completion_reason": None,
        "summary_status": PracticeSessionSummaryStatus.NOT_REQUESTED,
        "summary_payload": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _performance_session(**overrides: object) -> SimpleNamespace:
    values = {
        "state": PracticeSessionState.FINISHED,
        "progression_mode": PracticeProgressionMode.CONTINUOUS,
        "realtime_guidance": PracticeRealtimeGuidance.STATUS_ONLY,
        "evaluation_profile": PracticeEvaluationProfile.PERFORMANCE,
        "completion_reason": PracticeSessionCompletionReason.SCOPE_COMPLETED,
    }
    values.update(overrides)
    return _session(**values)


def _summary_payload(**overrides: object) -> str:
    payload: dict[str, object] = {
        "summary": "Performance session completed.",
        "metrics": {},
        "recommendations": [],
        "targets": [],
        "difficult_measures": [],
    }
    payload.update(overrides)
    return json.dumps(payload)


@pytest.mark.asyncio
async def test_practice_read_model_builds_session_detail() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(database, _session())

    assert detail.session_id == "session-1"
    assert detail.score_id == "score-1"
    assert detail.revision_id == "revision-1"
    assert detail.access_origin == AccessOrigin.OWNER
    assert detail.state == PracticeSessionState.CREATED
    assert detail.preset == PracticeSessionPreset.STEP_BY_STEP
    assert detail.progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE
    assert detail.realtime_guidance == PracticeRealtimeGuidance.GUIDED
    assert detail.evaluation_profile == PracticeEvaluationProfile.LEARNING
    assert detail.input_source == PracticeInputSource.MICROPHONE
    assert detail.practice_scope is None


@pytest.mark.asyncio
async def test_practice_read_model_builds_session_scope() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(
        database,
        _session(
            scope_start_expected_group_id="entry-4",
            scope_end_expected_group_id="entry-6",
            scope_start_measure_number="12",
            scope_end_measure_number="12",
        ),
    )

    assert detail.practice_scope is not None
    assert detail.practice_scope.start_expected_group_id == "entry-4"
    assert detail.practice_scope.end_expected_group_id == "entry-6"
    assert detail.practice_scope.start_measure_number == "12"
    assert detail.practice_scope.end_measure_number == "12"


@pytest.mark.asyncio
async def test_practice_read_model_rejects_missing_revision_context() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1") if model is Score else None
        )
    )

    with pytest.raises(ResourceNotFoundException) as error:
        await PracticeReadModel().to_session_detail(database, _session())

    assert error.value.code == ErrorCode.REVISION_NOT_FOUND


def test_practice_read_model_parses_summary_payload() -> None:
    summary = PracticeReadModel().to_session_summary_result(
        _session(
            summary_status=PracticeSessionSummaryStatus.READY,
            summary_payload=(
                '{"summary":"done","metrics":{"confidence":0.91},'
                '"recommendations":["keep going"]}'
            ),
        )
    )

    assert summary.session_id == "session-1"
    assert summary.summary_status == PracticeSessionSummaryStatus.READY
    assert summary.summary_payload is not None
    assert summary.summary_payload.summary == "done"
    assert summary.summary_payload.metrics == {"confidence": 0.91}
    assert summary.summary_payload.recommendations == ["keep going"]


@pytest.mark.asyncio
async def test_practice_read_model_exposes_full_piece_learning_outcome() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(
        database,
        _session(
            state=PracticeSessionState.FINISHED,
            completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
        ),
    )

    assert detail.completion_outcome is not None
    assert detail.completion_outcome.kind == "FULL_PIECE_LEARNING"
    assert detail.completion_outcome.scope_kind == "FULL_PIECE"
    assert detail.completion_outcome.summary_artifact_kind == "LEARNING_SUMMARY"
    assert detail.completion_outcome.completion_reason == PracticeSessionCompletionReason.SCOPE_COMPLETED
    assert detail.completion_outcome.playback_expected is False
    assert detail.completion_outcome.summary_available is False


@pytest.mark.asyncio
async def test_practice_read_model_exposes_selected_section_outcome() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(
        database,
        _session(
            state=PracticeSessionState.FINISHED,
            scope_start_expected_group_id="entry-4",
            scope_end_expected_group_id="entry-6",
            completion_reason=PracticeSessionCompletionReason.STOPPED_BY_USER,
        ),
    )

    assert detail.completion_outcome is not None
    assert detail.completion_outcome.kind == "SELECTED_SECTION"
    assert detail.completion_outcome.scope_kind == "SELECTED_RANGE"
    assert detail.completion_outcome.summary_artifact_kind == "SECTION_SUMMARY"
    assert detail.completion_outcome.completion_reason == PracticeSessionCompletionReason.STOPPED_BY_USER
    assert detail.completion_outcome.summary_available is False


@pytest.mark.asyncio
async def test_practice_read_model_exposes_full_piece_learning_outcome_for_midi() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(
        database,
        _session(
            state=PracticeSessionState.FINISHED,
            progression_mode=PracticeProgressionMode.WAIT_FOR_NOTE,
            realtime_guidance=PracticeRealtimeGuidance.GUIDED,
            evaluation_profile=PracticeEvaluationProfile.LEARNING,
            input_source=PracticeInputSource.MIDI,
            completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
        ),
    )

    assert detail.completion_outcome is not None
    assert detail.completion_outcome.kind == "FULL_PIECE_LEARNING"
    assert detail.completion_outcome.scope_kind == "FULL_PIECE"
    assert detail.completion_outcome.summary_artifact_kind == "LEARNING_SUMMARY"
    assert detail.completion_outcome.playback_expected is False
    assert detail.completion_outcome.summary_available is False


@pytest.mark.asyncio
async def test_practice_read_model_exposes_full_piece_performance_outcome() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(
        database,
        _session(
            state=PracticeSessionState.FINISHED,
            progression_mode=PracticeProgressionMode.CONTINUOUS,
            realtime_guidance=PracticeRealtimeGuidance.STATUS_ONLY,
            evaluation_profile=PracticeEvaluationProfile.PERFORMANCE,
            completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
        ),
    )

    assert detail.completion_outcome is not None
    assert detail.completion_outcome.kind == "FULL_PIECE_PERFORMANCE"
    assert detail.preset == PracticeSessionPreset.CONTINUOUS_PLAY
    assert detail.completion_outcome.scope_kind == "FULL_PIECE"
    assert detail.completion_outcome.summary_artifact_kind == "PERFORMANCE_SUMMARY"
    assert detail.completion_outcome.completion_reason == PracticeSessionCompletionReason.SCOPE_COMPLETED
    assert detail.completion_outcome.playback_expected is True


@pytest.mark.asyncio
async def test_practice_read_model_exposes_midi_performance_replay_expectation() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(
        database,
        _session(
            state=PracticeSessionState.FINISHED,
            progression_mode=PracticeProgressionMode.CONTINUOUS,
            realtime_guidance=PracticeRealtimeGuidance.STATUS_ONLY,
            evaluation_profile=PracticeEvaluationProfile.PERFORMANCE,
            input_source=PracticeInputSource.MIDI,
            completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
        ),
    )

    assert detail.completion_outcome is not None
    assert detail.completion_outcome.kind == "FULL_PIECE_PERFORMANCE"
    assert detail.completion_outcome.playback_expected is True


@pytest.mark.asyncio
async def test_practice_read_model_exposes_saved_replay_report_availability() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(
        database,
        _performance_session(),
        saved_replay_available=True,
    )

    assert detail.performance_report_availability is not None
    assert detail.performance_report_availability.saved_replay_available is True
    assert detail.performance_report_availability.evaluation_available is False


@pytest.mark.asyncio
async def test_practice_read_model_exposes_evaluation_without_saved_performance_availability() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(
        database,
        _performance_session(
            finished_at=SimpleNamespace(isoformat=lambda: "2026-09-05T10:30:00"),
            summary_status=PracticeSessionSummaryStatus.READY,
            summary_payload=_summary_payload(
                targets=[
                    {
                        "expected_group_id": "entry-1",
                        "confirmed_correct_render_note_ids": ["n1"],
                    }
                ],
            ),
        ),
    )

    assert detail.performance_report_availability is not None
    assert detail.performance_report_availability.saved_replay_available is False
    assert detail.performance_report_availability.evaluation_available is True


@pytest.mark.asyncio
async def test_practice_read_model_does_not_treat_empty_payload_as_report_evaluation() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(
        database,
        _performance_session(
            summary_status=PracticeSessionSummaryStatus.READY,
            summary_payload=_summary_payload(
                metrics={
                    "expected_outcome_count": 0,
                    "missing_strike_targets": 0,
                    "extra_pitch_count": 0,
                },
            ),
        ),
    )

    assert detail.performance_report_availability is not None
    assert detail.performance_report_availability.evaluation_available is False


@pytest.mark.asyncio
async def test_practice_read_model_treats_zero_error_counts_as_known_evaluation() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(
        database,
        _performance_session(
            summary_status=PracticeSessionSummaryStatus.READY,
            summary_payload=_summary_payload(
                metrics={
                    "expected_outcome_count": 12,
                    "matched_expected_groups": 12,
                    "missing_strike_targets": 0,
                    "extra_pitch_count": 0,
                },
            ),
        ),
    )

    assert detail.performance_report_availability is not None
    assert detail.performance_report_availability.evaluation_available is True


@pytest.mark.asyncio
async def test_practice_read_model_omits_report_availability_for_learning_sessions() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(
        database,
        _session(
            state=PracticeSessionState.FINISHED,
            completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
        ),
    )

    assert detail.performance_report_availability is None


def test_practice_read_model_builds_saved_performance() -> None:
    finished_at = SimpleNamespace(isoformat=lambda: "2026-09-05T10:30:00")
    started_at = SimpleNamespace(isoformat=lambda: "2026-09-05T10:29:00")
    saved_at = SimpleNamespace(isoformat=lambda: "2026-09-05T10:31:00")
    item = PracticeReadModel().to_saved_performance(
        _performance_session(
            scope_start_expected_group_id="entry-2",
            scope_end_expected_group_id="entry-4",
            scope_start_measure_number="2",
            scope_end_measure_number="4",
            started_at=started_at,
            finished_at=finished_at,
        ),
        SimpleNamespace(
            artifact_uuid="artifact-1",
            kind=PracticeReplayArtifactKind.AUDIO_RECORDING,
            duration_ms=61000,
            created_at=saved_at,
        ),
        revision_uuid="revision-1",
    )

    assert item.session_id == "session-1"
    assert item.revision_id == "revision-1"
    assert item.artifact_id == "artifact-1"
    assert item.kind == PracticeReplayArtifactKind.AUDIO_RECORDING
    assert item.practice_scope is not None
    assert item.practice_scope.start_measure_number == "2"
    assert item.practice_scope.end_measure_number == "4"
    assert item.started_at == "2026-09-05T10:29:00"
    assert item.finished_at == "2026-09-05T10:30:00"
    assert item.replay_duration_ms == 61000
    assert item.saved_at == "2026-09-05T10:31:00"
    assert item.evaluation_available is False


def test_practice_read_model_marks_saved_performance_evaluation_availability() -> None:
    item = PracticeReadModel().to_saved_performance(
        _performance_session(
            finished_at=SimpleNamespace(isoformat=lambda: "2026-09-05T10:30:00"),
            summary_status=PracticeSessionSummaryStatus.READY,
            summary_payload=_summary_payload(
                metrics={
                    "expected_outcome_count": 4,
                    "missing_strike_targets": 0,
                }
            ),
        ),
        SimpleNamespace(
            artifact_uuid="artifact-1",
            kind=PracticeReplayArtifactKind.MIDI_EVENTS,
            duration_ms=2000,
            created_at=SimpleNamespace(isoformat=lambda: "2026-09-05T10:31:00"),
        ),
        revision_uuid="revision-1",
    )

    assert item.evaluation_available is True
