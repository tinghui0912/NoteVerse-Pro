from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException
from app.db.models import (
    PracticeInputSource,
    PracticeReplayArtifact,
    PracticeSession,
    Score,
    ScoreRevision,
)
from app.db.models.practice import (
    PracticeEvaluationProfile,
    PracticeSessionSummaryStatus,
    PracticeSessionState,
)
from app.modules.practice.schemas import (
    PracticePerformanceReportAvailabilityRead,
    PracticePerformanceTimelineRead,
    PracticePerformanceTimelineSegmentRead,
    PracticeSessionCompletionOutcomeRead,
    PracticeSessionSummaryPayloadRead,
    PracticeSessionResultSummaryRead,
    PracticeSessionScope,
    PracticeSessionDetailRead,
    PracticeSessionStartRead,
    SavedPracticePerformanceRead,
)
from app.modules.practice.session_config import (
    PracticeRuntimeKind,
    PracticeSessionPreset,
    canonical_runtime_kind_for_execution_config,
)
from app.processing.performance.timeline import PerformanceTimelineProjection
from app.shared.constants import ErrorCode


class PracticeReadModel:
    """Build API-facing practice session read models."""

    def to_session_start(self, session: PracticeSession) -> PracticeSessionStartRead:
        return PracticeSessionStartRead(
            session_id=session.session_uuid,
            state=session.state,
            ws_url=f"/api/v1/practice/sessions/{session.session_uuid}/stream",
        )

    async def to_session_detail(
        self,
        db: AsyncSession,
        session: PracticeSession,
        *,
        saved_replay_available: bool = False,
    ) -> PracticeSessionDetailRead:
        score = await db.get(Score, session.score_id)
        revision = await db.get(ScoreRevision, session.revision_id)
        if not score or not revision or not session.access_origin:
            raise ResourceNotFoundException(
                "practice_revision", session.session_uuid, ErrorCode.REVISION_NOT_FOUND
            )
        return PracticeSessionDetailRead(
            session_id=session.session_uuid,
            score_id=score.score_uuid,
            revision_id=revision.revision_uuid,
            access_origin=session.access_origin,
            state=session.state,
            preset=_preset_for_session(session),
            progression_mode=session.progression_mode,
            realtime_guidance=session.realtime_guidance,
            evaluation_profile=session.evaluation_profile,
            input_source=session.input_source,
            practice_scope=(
                PracticeSessionScope(
                    start_expected_group_id=session.scope_start_expected_group_id,
                    end_expected_group_id=session.scope_end_expected_group_id,
                    start_measure_number=session.scope_start_measure_number,
                    end_measure_number=session.scope_end_measure_number,
                )
                if session.scope_start_expected_group_id
                else None
            ),
            sample_rate=session.sample_rate,
            channels=session.channels,
            frame_format=session.frame_format,
            started_at=session.started_at.isoformat() if session.started_at else None,
            finished_at=session.finished_at.isoformat() if session.finished_at else None,
            last_beat_position=session.last_beat_position,
            last_confidence=session.last_confidence,
            summary_status=session.summary_status,
            completion_outcome=_completion_outcome_for_session(session),
            performance_report_availability=_performance_report_availability_for_session(
                session,
                saved_replay_available=saved_replay_available,
            ),
        )

    def to_session_summary_result(
        self,
        session: PracticeSession,
        *,
        performance_timeline: PracticePerformanceTimelineRead | None = None,
    ) -> PracticeSessionResultSummaryRead:
        parsed_payload: PracticeSessionSummaryPayloadRead | None = None
        if session.summary_payload:
            parsed_payload = PracticeSessionSummaryPayloadRead.model_validate(
                json.loads(session.summary_payload)
            )
        return PracticeSessionResultSummaryRead(
            session_id=session.session_uuid,
            summary_status=session.summary_status,
            summary_payload=parsed_payload,
            performance_timeline=performance_timeline,
        )

    def to_saved_performance(
        self,
        session: PracticeSession,
        artifact: PracticeReplayArtifact,
        *,
        revision_uuid: str,
    ) -> SavedPracticePerformanceRead:
        if session.evaluation_profile != PracticeEvaluationProfile.PERFORMANCE:
            raise RuntimeError("saved performance requires a performance practice session")
        if session.state != PracticeSessionState.FINISHED:
            raise RuntimeError("saved performance requires a finished practice session")
        if session.finished_at is None:
            raise RuntimeError("finished practice session is missing finished_at")
        if session.completion_reason is None:
            raise RuntimeError("finished practice session is missing completion reason")
        return SavedPracticePerformanceRead(
            session_id=session.session_uuid,
            revision_id=revision_uuid,
            artifact_id=artifact.artifact_uuid,
            kind=artifact.kind,
            input_source=session.input_source,
            practice_scope=(
                PracticeSessionScope(
                    start_expected_group_id=session.scope_start_expected_group_id,
                    end_expected_group_id=session.scope_end_expected_group_id,
                    start_measure_number=session.scope_start_measure_number,
                    end_measure_number=session.scope_end_measure_number,
                )
                if session.scope_start_expected_group_id
                else None
            ),
            started_at=session.started_at.isoformat() if session.started_at else None,
            finished_at=session.finished_at.isoformat(),
            completion_reason=session.completion_reason,
            replay_duration_ms=artifact.duration_ms,
            saved_at=artifact.created_at.isoformat(),
            evaluation_available=has_durable_performance_evaluation(session),
        )


def performance_timeline_read_model(
    projection: PerformanceTimelineProjection,
) -> PracticePerformanceTimelineRead:
    return PracticePerformanceTimelineRead(
        scope_start_beat=projection.scope_start_beat,
        scope_terminal_beat=projection.scope_terminal_beat,
        segments=[
            PracticePerformanceTimelineSegmentRead(
                start_performance_time_ms=segment.start_performance_time_ms,
                end_performance_time_ms=segment.end_performance_time_ms,
                start_beat=segment.start_beat,
                end_beat=segment.end_beat,
            )
            for segment in projection.segments
        ],
    )


def _preset_for_session(session: PracticeSession) -> PracticeSessionPreset:
    runtime_kind = canonical_runtime_kind_for_execution_config(
        progression_mode=session.progression_mode,
        realtime_guidance=session.realtime_guidance,
        evaluation_profile=session.evaluation_profile,
    )
    if runtime_kind == PracticeRuntimeKind.STEP_BY_STEP:
        return PracticeSessionPreset.STEP_BY_STEP
    if runtime_kind == PracticeRuntimeKind.FIXED_CLOCK_PERFORMANCE:
        return PracticeSessionPreset.CONTINUOUS_PLAY
    raise RuntimeError(f"unsupported practice runtime kind: {runtime_kind}")


def _completion_outcome_for_session(
    session: PracticeSession,
) -> PracticeSessionCompletionOutcomeRead | None:
    if session.state != PracticeSessionState.FINISHED:
        return None
    if session.completion_reason is None:
        raise RuntimeError("finished practice session is missing completion reason")

    playback_expected = session.evaluation_profile == PracticeEvaluationProfile.PERFORMANCE
    is_selected_section = bool(session.scope_start_expected_group_id)
    if is_selected_section:
        return PracticeSessionCompletionOutcomeRead(
            kind="SELECTED_SECTION",
            scope_kind="SELECTED_RANGE",
            summary_artifact_kind="SECTION_SUMMARY",
            completion_reason=session.completion_reason,
            playback_expected=playback_expected,
        )

    is_performance = session.evaluation_profile == PracticeEvaluationProfile.PERFORMANCE
    return PracticeSessionCompletionOutcomeRead(
        kind="FULL_PIECE_PERFORMANCE" if is_performance else "FULL_PIECE_LEARNING",
        scope_kind="FULL_PIECE",
        summary_artifact_kind="PERFORMANCE_SUMMARY" if is_performance else "LEARNING_SUMMARY",
        completion_reason=session.completion_reason,
        playback_expected=playback_expected,
    )


def _performance_report_availability_for_session(
    session: PracticeSession,
    *,
    saved_replay_available: bool,
) -> PracticePerformanceReportAvailabilityRead | None:
    if (
        session.evaluation_profile != PracticeEvaluationProfile.PERFORMANCE
        or session.state != PracticeSessionState.FINISHED
    ):
        return None

    evaluation_available = has_durable_performance_evaluation(session)
    return PracticePerformanceReportAvailabilityRead(
        saved_replay_available=saved_replay_available,
        evaluation_available=evaluation_available,
    )


def has_durable_performance_evaluation(session: PracticeSession) -> bool:
    if (
        session.evaluation_profile != PracticeEvaluationProfile.PERFORMANCE
        or session.state != PracticeSessionState.FINISHED
        or session.input_source != PracticeInputSource.MIDI
        or session.summary_status != PracticeSessionSummaryStatus.READY
        or not session.summary_payload
    ):
        return False

    try:
        payload = json.loads(session.summary_payload)
    except (TypeError, json.JSONDecodeError):
        return False

    if not isinstance(payload, dict):
        return False

    problem_measures = payload.get("problem_measures")
    if isinstance(problem_measures, list) and len(problem_measures) > 0:
        return True

    targets = payload.get("targets")
    if isinstance(targets, list) and any(
        _target_has_performance_evidence(target) for target in targets
    ):
        return True

    metrics = payload.get("metrics")
    if not isinstance(metrics, dict):
        return False

    expected_outcome_count = metrics.get("expected_outcome_count")
    if not _is_number(expected_outcome_count) or expected_outcome_count <= 0:
        return False

    return any(
        _is_number(metrics.get(key))
        for key in (
            "matched_expected_groups",
            "partial_expected_groups",
            "mismatched_expected_groups",
            "uncertain_expected_groups",
            "not_observed_expected_groups",
            "confirmed_correct_strike_targets",
            "missing_strike_targets",
            "extra_pitch_count",
            "problem_measure_count",
        )
    )


def _target_has_performance_evidence(target: object) -> bool:
    if not isinstance(target, dict):
        return False
    for key in (
        "confirmed_correct_render_note_ids",
        "confirmed_error_render_note_ids",
        "missing_pitches",
        "unexpected_pitches",
    ):
        value = target.get(key)
        if isinstance(value, list) and len(value) > 0:
            return True
    return False


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)
