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
    PracticeSourceType,
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
from app.shared.constants import ErrorCode
from app.shared.file_kinds import FileKind
from app.storage.paths import materialize_storage_key
from app.utils.timezone import utc_now_naive


class PracticeService:
    """Service boundary for practice-session orchestration."""

    def __init__(
        self,
        repository: PracticeRepository | None = None,
        runtime_registry: PracticeSessionRuntimeRegistry | None = None,
        report_builder: PracticeReportBuilder | None = None,
    ) -> None:
        self.repository = repository or PracticeRepository()
        self.runtime_registry = runtime_registry or practice_runtime_registry
        self.report_builder = report_builder or practice_report_builder

    async def create_session(
        self,
        db: AsyncSession,
        task_uuid: str,
        user_id: int,
        source: str,
        sample_rate: int,
        channels: int,
        frame_format: str,
        share_token: str | None = None,
    ) -> PracticeSessionSummaryResult:
        task = await self.repository.get_task_by_uuid(db, task_uuid)
        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=task_uuid,
                code=ErrorCode.TASK_NOT_FOUND,
            )

        await self._validate_task_access(db, task, user_id, share_token)
        task_id = require_persisted_id(task.id, entity="task")
        score_file_path = await self._prepare_score_file(db, task_id, source)

        session = PracticeSession(
            session_uuid=str(uuid4()),
            task_id=task_id,
            user_id=user_id,
            share_token=share_token,
            source_type=PracticeSourceType(source),
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
                task_id=task.task_uuid,
                state=session.state.value,
                score_file_path=score_file_path,
                sample_rate=sample_rate,
                channels=channels,
                frame_format=frame_format,
            )
        except Exception as exc:
            logger.exception(
                "practice_session_runtime_registration_failed "
                f"task_id={task.task_uuid} "
                f"session_id={session.session_uuid} "
                f"source={source}"
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
        task = await self.repository.get_task_by_id(db, session.task_id)
        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=str(session.task_id),
                code=ErrorCode.TASK_NOT_FOUND,
            )
        return self._to_session_detail(session, task.task_uuid)

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
        task = await self.repository.get_task_by_id(db, session.task_id)
        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=str(session.task_id),
                code=ErrorCode.TASK_NOT_FOUND,
            )
        return self._to_session_detail(session, task.task_uuid)

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
        task = await self.repository.get_task_by_id(db, session.task_id)
        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=str(session.task_id),
                code=ErrorCode.TASK_NOT_FOUND,
            )
        return self._to_session_detail(session, task.task_uuid)

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
        task = await self.repository.get_task_by_id(db, session.task_id)
        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=str(session.task_id),
                code=ErrorCode.TASK_NOT_FOUND,
            )
        return self._to_session_detail(session, task.task_uuid)

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
        task = await self.repository.get_task_by_id(db, session.task_id)
        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=str(session.task_id),
                code=ErrorCode.TASK_NOT_FOUND,
            )
        return self._to_session_detail(session, task.task_uuid)

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

    async def _validate_task_access(
        self,
        db: AsyncSession,
        task,
        user_id: int,
        share_token: str | None,
    ) -> None:
        if task.user_id == user_id:
            return

        if not share_token:
            raise UnauthorizedException(
                code=ErrorCode.NO_PRACTICE_ACCESS,
                details={"task_id": task.task_uuid},
            )

        share = await self.repository.get_share_by_token(db, share_token)
        if not share or share.task_id != require_persisted_id(task.id, entity="task"):
            raise UnauthorizedException(
                code=ErrorCode.NO_PRACTICE_ACCESS,
                details={"task_id": task.task_uuid},
            )
        if share.revoked_at:
            raise ValidationException(code=ErrorCode.SHARE_REVOKED, field="share_token")
        if share.expires_at and share.expires_at < utc_now_naive():
            raise ValidationException(code=ErrorCode.SHARE_EXPIRED, field="share_token")

    async def _prepare_score_file(
        self,
        db: AsyncSession,
        task_id: int,
        source: str,
    ) -> str:
        if source == PracticeSourceType.final.value:
            file_record = await self.repository.get_task_file_by_kind(db, task_id, FileKind.FINAL_XML)
        else:
            file_record = await self.repository.get_task_file_by_kind(db, task_id, FileKind.CURRENT_XML)
            if file_record is None:
                file_record = await self.repository.get_task_file_by_kind(
                    db,
                    task_id,
                    FileKind.ENHANCED_XML,
                )

        if file_record is None:
            raise ResourceNotFoundException(
                resource_type="xml",
                resource_id=str(task_id),
                code=ErrorCode.FILE_NOT_FOUND,
            )

        xml_path = materialize_storage_key(file_record.storage_key)
        return xml_path

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
    def _to_session_detail(
        session: PracticeSession,
        task_uuid: str,
    ) -> PracticeSessionDetailResult:
        return {
            "session_id": session.session_uuid,
            "task_id": task_uuid,
            "state": session.state.value,
            "source": session.source_type.value,
            "share_token": session.share_token,
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
