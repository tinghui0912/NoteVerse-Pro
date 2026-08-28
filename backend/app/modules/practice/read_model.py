from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException
from app.db.models import PracticeSession, Score, ScoreRevision
from app.db.models.practice import (
    PracticeInputSource,
    PracticeProgressionMode,
    PracticeSessionState,
)
from app.modules.practice.schemas import (
    PracticeSessionCompletionOutcomeRead,
    PracticeSessionSummaryPayloadRead,
    PracticeSessionResultSummaryRead,
    PracticeSessionScope,
    PracticeSessionDetailRead,
    PracticeSessionStartRead,
)
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
        )

    def to_session_summary_result(self, session: PracticeSession) -> PracticeSessionResultSummaryRead:
        parsed_payload: PracticeSessionSummaryPayloadRead | None = None
        if session.summary_payload:
            parsed_payload = PracticeSessionSummaryPayloadRead.model_validate(
                json.loads(session.summary_payload)
            )
        return PracticeSessionResultSummaryRead(
            session_id=session.session_uuid,
            summary_status=session.summary_status,
            summary_payload=parsed_payload,
        )


def _completion_outcome_for_session(
    session: PracticeSession,
) -> PracticeSessionCompletionOutcomeRead | None:
    if session.state != PracticeSessionState.FINISHED:
        return None

    playback_expected = session.input_source == PracticeInputSource.MICROPHONE
    is_selected_section = bool(session.scope_start_expected_group_id)
    if is_selected_section:
        return PracticeSessionCompletionOutcomeRead(
            kind="SELECTED_SECTION",
            scope_kind="SELECTED_RANGE",
            summary_artifact_kind="SECTION_SUMMARY",
            playback_expected=playback_expected,
            summary_available=False,
        )

    if session.progression_mode == PracticeProgressionMode.CONTINUOUS:
        return PracticeSessionCompletionOutcomeRead(
            kind="FULL_PIECE_PERFORMANCE",
            scope_kind="FULL_PIECE",
            summary_artifact_kind="PERFORMANCE_SUMMARY",
            playback_expected=playback_expected,
            summary_available=True,
        )

    return PracticeSessionCompletionOutcomeRead(
        kind="FULL_PIECE_LEARNING",
        scope_kind="FULL_PIECE",
        summary_artifact_kind="LEARNING_SUMMARY",
        playback_expected=playback_expected,
        summary_available=False,
    )
