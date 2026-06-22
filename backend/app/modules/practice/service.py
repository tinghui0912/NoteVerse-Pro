from __future__ import annotations

import json
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ExternalServiceException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.core.logger import logger
from app.db.models import (
    PracticeReportStatus,
    PracticeSession,
    PracticeSessionState,
    Score,
    ScoreRevision,
)
from app.db.model_utils import require_persisted_id
from app.processing.engines.matchmaker_live import AlignmentUpdate
from app.processing.reports.practice_report import (
    PracticeReportBuilder,
    practice_report_builder,
)
from app.processing.realtime.session_runtime import (
    PracticeSessionRuntimeRegistry,
    practice_runtime_registry,
)
from app.modules.practice.repository import PracticeRepository
from app.modules.practice.schemas import (
    PracticeReportResult,
    PracticeSessionDetailResult,
    PracticeSessionSummaryResult,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.scores.repository import ScoreRepository
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class PracticeService:
    """Service boundary for practice-session orchestration."""

    def __init__(
        self,
        repository: PracticeRepository | None = None,
        runtime_registry: PracticeSessionRuntimeRegistry | None = None,
        report_builder: PracticeReportBuilder | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        score_repository: ScoreRepository | None = None,
        storage: FileStorage | None = None,
    ) -> None:
        self.repository = repository or PracticeRepository()
        self.runtime_registry = runtime_registry or practice_runtime_registry
        self.report_builder = report_builder or practice_report_builder
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.score_repository = score_repository or ScoreRepository()
        self.storage = storage or file_storage

    async def create_session(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        revision_uuid: str | None,
        sample_rate: int,
        channels: int,
        frame_format: str,
        share_token: str | None = None,
        public_slug: str | None = None,
    ) -> PracticeSessionSummaryResult:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            revision_uuid=revision_uuid,
            share_token=share_token,
            public_slug=public_slug,
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        revision_id = require_persisted_id(access.revision.id, entity="score revision")
        artifact = await self.score_repository.canonical_artifact(db, revision_id)
        if not artifact:
            raise ResourceNotFoundException("artifact", revision_uuid, ErrorCode.FILE_NOT_FOUND)
        score_file_path = self.storage.materialize_to_local(
            artifact.storage_key, self.storage.local_path(artifact.storage_key)
        )

        session = PracticeSession(
            session_uuid=str(uuid4()),
            score_id=score_id,
            revision_id=revision_id,
            access_origin=access.origin,
            share_grant_id=access.grant.id if access.grant else None,
            user_id=user_id,
            state=PracticeSessionState.CREATED,
            sample_rate=sample_rate,
            channels=channels,
            frame_format=frame_format,
            report_status=PracticeReportStatus.NOT_REQUESTED,
        )
        session = await self.repository.create_session(db, session)
        try:
            self.runtime_registry.register(
                session_id=session.session_uuid,
                task_id=access.score.score_uuid,
                state=session.state.value,
                score_file_path=score_file_path,
                sample_rate=sample_rate,
                channels=channels,
                frame_format=frame_format,
            )
        except Exception as exc:
            logger.exception(
                "practice_session_runtime_registration_failed "
                f"score_id={access.score.score_uuid} "
                f"session_id={session.session_uuid} "
                f"revision_id={access.revision.revision_uuid}"
            )
            session.state = PracticeSessionState.FAILED
            session.error = str(exc)
            await self.repository.save_session(db, session)
            raise ExternalServiceException(
                service="matchmaker",
                code=ErrorCode.PRACTICE_ALIGNMENT_FAILED,
                details={"reason": str(exc)},
            ) from exc
        return self._to_session_summary(session)

    async def get_session_detail(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionDetailResult:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        return await self._to_session_detail(db, session)

    async def require_session_access(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSession:
        return await self._require_session_for_user(db, session_uuid, user_id)

    async def start_session_stream(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionDetailResult:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        if session.state not in {PracticeSessionState.CREATED, PracticeSessionState.STREAMING}:
            raise ValidationException(
                code=ErrorCode.PRACTICE_SESSION_INVALID_STATE,
                field="state",
            )
        session.state = PracticeSessionState.STREAMING
        if session.started_at is None:
            session.started_at = utc_now_naive()
        session = await self.repository.save_session(db, session)
        self._update_runtime_state(session.session_uuid, session.state.value)
        return await self._to_session_detail(db, session)

    async def pause_session(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionDetailResult:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        if session.state not in {PracticeSessionState.CREATED, PracticeSessionState.STREAMING}:
            raise ValidationException(
                code=ErrorCode.PRACTICE_SESSION_INVALID_STATE,
                field="state",
            )
        session.state = PracticeSessionState.PAUSED
        session = await self.repository.save_session(db, session)
        self._update_runtime_state(session.session_uuid, session.state.value)
        return await self._to_session_detail(db, session)

    async def resume_session(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionDetailResult:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        if session.state != PracticeSessionState.PAUSED:
            raise ValidationException(
                code=ErrorCode.PRACTICE_SESSION_INVALID_STATE,
                field="state",
            )
        session.state = PracticeSessionState.STREAMING
        if session.started_at is None:
            session.started_at = utc_now_naive()
        session = await self.repository.save_session(db, session)
        self._update_runtime_state(session.session_uuid, session.state.value)
        return await self._to_session_detail(db, session)

    async def finish_session(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionDetailResult:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        if session.state in {PracticeSessionState.FINISHED, PracticeSessionState.FAILED}:
            raise ValidationException(
                code=ErrorCode.PRACTICE_SESSION_INVALID_STATE,
                field="state",
            )
        if session.started_at is None:
            session.started_at = utc_now_naive()
        session.state = PracticeSessionState.FINISHED
        session.finished_at = utc_now_naive()
        session = await self.repository.save_session(db, session)
        self.runtime_registry.release(session.session_uuid)
        return await self._to_session_detail(db, session)

    async def request_report(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeReportResult:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        if session.state != PracticeSessionState.FINISHED:
            raise ValidationException(
                code=ErrorCode.PRACTICE_SESSION_INVALID_STATE,
                field="state",
            )
        session.report_status = PracticeReportStatus.PENDING
        session = await self.repository.save_report(db, session)

        try:
            report_payload = self.report_builder.build(session)
        except Exception as exc:
            session.report_status = PracticeReportStatus.FAILED
            session.report_payload = json.dumps(
                {"summary": "Practice report generation failed."}
            )
            session.error = str(exc)
            session = await self.repository.save_report(db, session)
            raise ValidationException(
                code=ErrorCode.PRACTICE_REPORT_FAILED,
                field="report",
            ) from exc

        session.report_status = PracticeReportStatus.READY
        session.report_payload = json.dumps(report_payload)
        session.error = None
        session = await self.repository.save_report(db, session)
        return self._to_report_result(session)

    async def persist_alignment(
        self,
        db: AsyncSession,
        session_uuid: str,
        alignment: AlignmentUpdate,
    ) -> None:
        session = await self.repository.get_session_by_uuid(db, session_uuid)
        if not session:
            raise ResourceNotFoundException(
                resource_type="practice_session",
                resource_id=session_uuid,
                code=ErrorCode.PRACTICE_SESSION_NOT_FOUND,
            )
        session.last_beat_position = alignment["beat_position"]
        session.last_confidence = alignment["confidence"]
        await self.repository.save_session(db, session)

    async def get_report(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeReportResult:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        return self._to_report_result(session)

    async def _require_session_for_user(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSession:
        session = await self.repository.get_session_by_uuid(db, session_uuid)
        if not session:
            raise ResourceNotFoundException(
                resource_type="practice_session",
                resource_id=session_uuid,
                code=ErrorCode.PRACTICE_SESSION_NOT_FOUND,
            )
        if session.user_id != user_id:
            raise UnauthorizedException(
                code=ErrorCode.NO_PRACTICE_ACCESS,
                details={"session_id": session_uuid},
            )
        return session

    def _update_runtime_state(self, session_uuid: str, state: str) -> None:
        runtime = self.runtime_registry.get(session_uuid)
        if runtime is not None:
            runtime.state = state

    @staticmethod
    def _to_session_summary(session: PracticeSession) -> PracticeSessionSummaryResult:
        return {
            "session_id": session.session_uuid,
            "state": session.state.value,
            "ws_url": f"/api/v1/practice/sessions/{session.session_uuid}/stream",
        }

    @staticmethod
    async def _to_session_detail(
        db: AsyncSession,
        session: PracticeSession,
    ) -> PracticeSessionDetailResult:
        score = await db.get(Score, session.score_id)
        revision = await db.get(ScoreRevision, session.revision_id)
        if not score or not revision or not session.access_origin:
            raise ResourceNotFoundException(
                "practice_revision", session.session_uuid, ErrorCode.REVISION_NOT_FOUND
            )
        return {
            "session_id": session.session_uuid,
            "score_id": score.score_uuid,
            "revision_id": revision.revision_uuid,
            "access_origin": session.access_origin.value,
            "state": session.state.value,
            "sample_rate": session.sample_rate,
            "channels": session.channels,
            "frame_format": session.frame_format,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "finished_at": session.finished_at.isoformat() if session.finished_at else None,
            "last_beat_position": session.last_beat_position,
            "last_confidence": session.last_confidence,
            "report_status": session.report_status.value,
        }

    @staticmethod
    def _to_report_result(session: PracticeSession) -> PracticeReportResult:
        parsed_payload: dict[str, object] | None = None
        if session.report_payload:
            parsed_payload = json.loads(session.report_payload)
        return {
            "session_id": session.session_uuid,
            "report_status": session.report_status.value,
            "report_payload": parsed_payload,
        }
