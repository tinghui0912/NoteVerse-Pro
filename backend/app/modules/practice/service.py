from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING
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
    PracticeInputSource,
    PracticeMode,
    Score,
    ScoreRevision,
)
from app.db.model_utils import require_persisted_id
from app.processing.reports.practice_report import (
    PracticeReportBuilder,
    practice_report_builder,
)
from app.processing.realtime.session_runtime import (
    PracticeSessionRuntime,
    PracticeSessionRuntimeRegistry,
    practice_runtime_registry,
)
from app.modules.practice.read_model import PracticeReadModel
from app.modules.practice.repository import PracticeRepository
from app.modules.practice.schemas import (
    PracticeReportRead,
    PracticeSessionDetailRead,
    PracticeSessionSummaryRead,
)
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.scores.repository import ScoreRepository
from app.modules.library.service import LibraryService
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from app.processing.engines.practice_alignment.contracts import AlignmentUpdate


class PracticeService:
    """Service boundary for practice-session orchestration."""

    def __init__(
        self,
        repository: PracticeRepository | None = None,
        runtime_registry: PracticeSessionRuntimeRegistry | None = None,
        report_builder: PracticeReportBuilder | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        score_repository: ScoreRepository | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        library_service: LibraryService | None = None,
        storage: FileStorage | None = None,
        read_model: PracticeReadModel | None = None,
    ) -> None:
        self.repository = repository or PracticeRepository()
        self.runtime_registry = runtime_registry or practice_runtime_registry
        self.report_builder = report_builder or practice_report_builder
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.score_repository = score_repository or ScoreRepository()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.library_service = library_service or LibraryService()
        self.storage = storage or file_storage
        self.read_model = read_model or PracticeReadModel()

    async def create_session(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        revision_uuid: str | None,
        sample_rate: int,
        channels: int,
        frame_format: str,
        practice_mode: PracticeMode = PracticeMode.FREE_FOLLOW,
        input_source: PracticeInputSource = PracticeInputSource.MICROPHONE,
    ) -> PracticeSessionSummaryRead:
        if practice_mode != PracticeMode.FREE_FOLLOW:
            raise ValidationException(field="practice_mode")
        if input_source != PracticeInputSource.MICROPHONE:
            raise ValidationException(field="input_source")
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        revision_id = require_persisted_id(access.revision.id, entity="score revision")
        source = await self.asset_repository.canonical_source(db, revision_id)
        if not source:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)

        session = PracticeSession(
            session_uuid=str(uuid4()),
            score_id=score_id,
            revision_id=revision_id,
            access_origin=access.origin,
            share_grant_id=access.grant.id if access.grant else None,
            user_id=user_id,
            state=PracticeSessionState.CREATED,
            practice_mode=practice_mode,
            input_source=input_source,
            sample_rate=sample_rate,
            channels=channels,
            frame_format=frame_format,
            report_status=PracticeReportStatus.NOT_REQUESTED,
        )
        session = await self.repository.create_session(db, session)
        return self.read_model.to_session_summary(session)

    async def get_session_detail(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionDetailRead:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        return await self.read_model.to_session_detail(db, session)

    async def require_session_access(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSession:
        return await self._require_session_for_user(db, session_uuid, user_id)

    async def prepare_stream_runtime(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionRuntime:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        runtime = self.runtime_registry.get(session_uuid)
        if runtime is not None:
            return runtime

        if session.state in {PracticeSessionState.FINISHED, PracticeSessionState.FAILED}:
            raise ValidationException(
                code=ErrorCode.PRACTICE_SESSION_INVALID_STATE,
                field="state",
            )

        score = await db.get(Score, session.score_id)
        revision = await db.get(ScoreRevision, session.revision_id)
        if not score or not revision:
            raise ResourceNotFoundException(
                "practice_revision",
                session_uuid,
                ErrorCode.REVISION_NOT_FOUND,
            )
        revision_id = require_persisted_id(revision.id, entity="score revision")
        source = await self.asset_repository.canonical_source(db, revision_id)
        if not source:
            raise ResourceNotFoundException(
                "practice_revision_source",
                revision.revision_uuid,
                ErrorCode.FILE_NOT_FOUND,
            )
        score_file_path = self.storage.materialize_to_local(
            source.storage_key,
            self.storage.local_path(source.storage_key),
        )

        try:
            return await asyncio.to_thread(
                self.runtime_registry.register,
                session_id=session.session_uuid,
                task_id=score.score_uuid,
                state=session.state.value,
                score_file_path=score_file_path,
                sample_rate=session.sample_rate,
                channels=session.channels,
                frame_format=session.frame_format,
                practice_mode=session.practice_mode.value,
                input_source=session.input_source.value,
            )
        except Exception as exc:
            logger.bind(
                event="practice.session_runtime.registration_failed",
                score_id=score.score_uuid,
                session_id=session.session_uuid,
                revision_id=revision.revision_uuid,
            ).opt(exception=exc).warning("Practice session runtime registration failed")
            session.state = PracticeSessionState.FAILED
            session.error = str(exc)
            await self.repository.save_session(db, session)
            raise ExternalServiceException(
                service="practice_alignment",
                code=ErrorCode.PRACTICE_ALIGNMENT_FAILED,
            ) from exc

    async def start_session_stream(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionDetailRead:
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
        return await self.read_model.to_session_detail(db, session)

    async def pause_session(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionDetailRead:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        if session.state not in {PracticeSessionState.CREATED, PracticeSessionState.STREAMING}:
            raise ValidationException(
                code=ErrorCode.PRACTICE_SESSION_INVALID_STATE,
                field="state",
            )
        session.state = PracticeSessionState.PAUSED
        session = await self.repository.save_session(db, session)
        self._update_runtime_state(session.session_uuid, session.state.value)
        return await self.read_model.to_session_detail(db, session)

    async def resume_session(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionDetailRead:
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
        return await self.read_model.to_session_detail(db, session)

    async def finish_session(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionDetailRead:
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
        await self.library_service.mark_practiced(db, user_id, session.score_id)
        await db.commit()
        self.runtime_registry.release(session.session_uuid)
        return await self.read_model.to_session_detail(db, session)

    async def request_report(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeReportRead:
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
            session.report_payload = json.dumps({"summary": "Practice report generation failed."})
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
        return self.read_model.to_report_result(session)

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
    ) -> PracticeReportRead:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        return self.read_model.to_report_result(session)

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
