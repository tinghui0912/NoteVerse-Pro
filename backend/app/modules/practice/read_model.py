from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException
from app.db.models import PracticeSession, Score, ScoreRevision
from app.modules.practice.schemas import (
    PracticeReportPayloadRead,
    PracticeReportRead,
    PracticeSessionDetailRead,
    PracticeSessionSummaryRead,
)
from app.shared.constants import ErrorCode


class PracticeReadModel:
    """Build API-facing practice session read models."""

    def to_session_summary(self, session: PracticeSession) -> PracticeSessionSummaryRead:
        return PracticeSessionSummaryRead(
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
            practice_mode=session.practice_mode,
            input_source=session.input_source,
            sample_rate=session.sample_rate,
            channels=session.channels,
            frame_format=session.frame_format,
            started_at=session.started_at.isoformat() if session.started_at else None,
            finished_at=session.finished_at.isoformat() if session.finished_at else None,
            last_beat_position=session.last_beat_position,
            last_confidence=session.last_confidence,
            report_status=session.report_status,
        )

    def to_report_result(self, session: PracticeSession) -> PracticeReportRead:
        parsed_payload: PracticeReportPayloadRead | None = None
        if session.report_payload:
            parsed_payload = PracticeReportPayloadRead.model_validate(
                json.loads(session.report_payload)
            )
        return PracticeReportRead(
            session_id=session.session_uuid,
            report_status=session.report_status,
            report_payload=parsed_payload,
        )
