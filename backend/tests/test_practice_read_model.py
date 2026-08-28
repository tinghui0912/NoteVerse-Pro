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
    PracticeSessionSummaryStatus,
    PracticeSessionState,
)
from app.db.models.score_access import AccessOrigin
from app.modules.practice.read_model import PracticeReadModel
from app.shared.constants import ErrorCode


def _session(**overrides: object) -> SimpleNamespace:
    values = {
        "session_uuid": "session-1",
        "score_id": 11,
        "revision_id": 12,
        "access_origin": AccessOrigin.OWNER,
        "state": PracticeSessionState.CREATED,
        "progression_mode": PracticeProgressionMode.CONTINUOUS,
        "realtime_guidance": PracticeRealtimeGuidance.STATUS_ONLY,
        "evaluation_profile": PracticeEvaluationProfile.PERFORMANCE,
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
        "summary_status": PracticeSessionSummaryStatus.NOT_REQUESTED,
        "summary_payload": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


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
    assert detail.progression_mode == PracticeProgressionMode.CONTINUOUS
    assert detail.realtime_guidance == PracticeRealtimeGuidance.STATUS_ONLY
    assert detail.evaluation_profile == PracticeEvaluationProfile.PERFORMANCE
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
        _session(state=PracticeSessionState.FINISHED),
    )

    assert detail.completion_outcome is not None
    assert detail.completion_outcome.kind == "FULL_PIECE_PERFORMANCE"
    assert detail.completion_outcome.scope_kind == "FULL_PIECE"
    assert detail.completion_outcome.summary_artifact_kind == "PERFORMANCE_SUMMARY"
    assert detail.completion_outcome.playback_expected is True
    assert detail.completion_outcome.summary_available is True


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
        ),
    )

    assert detail.completion_outcome is not None
    assert detail.completion_outcome.kind == "SELECTED_SECTION"
    assert detail.completion_outcome.scope_kind == "SELECTED_RANGE"
    assert detail.completion_outcome.summary_artifact_kind == "SECTION_SUMMARY"
    assert detail.completion_outcome.summary_available is False


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
            progression_mode=PracticeProgressionMode.WAIT_FOR_NOTE,
            realtime_guidance=PracticeRealtimeGuidance.GUIDED,
            evaluation_profile=PracticeEvaluationProfile.LEARNING,
            input_source=PracticeInputSource.MIDI,
        ),
    )

    assert detail.completion_outcome is not None
    assert detail.completion_outcome.kind == "FULL_PIECE_LEARNING"
    assert detail.completion_outcome.scope_kind == "FULL_PIECE"
    assert detail.completion_outcome.summary_artifact_kind == "LEARNING_SUMMARY"
    assert detail.completion_outcome.playback_expected is False
    assert detail.completion_outcome.summary_available is False
