from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import TYPE_CHECKING, Literal
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
    PracticeAttempt,
    PracticeAttemptCompletionStatus,
    PracticeAttemptResolutionReason,
    PracticeAttemptResult,
    PracticeEvaluationProfile,
    PracticeInputSource,
    PracticeProgressionMode,
    PracticeRealtimeGuidance,
    PracticeSessionSummaryStatus,
    PracticeSession,
    PracticeSessionState,
    Score,
    ScoreRevision,
)
from app.db.model_utils import require_persisted_id
from app.processing.reports.practice_session_summary import (
    PracticeSessionSummaryBuilder,
    practice_session_summary_builder,
)
from app.processing.realtime.session_runtime import (
    PracticeSessionRuntime,
    PracticeSessionRuntimeRegistry,
    practice_runtime_registry,
)
from app.modules.practice.read_model import PracticeReadModel
from app.modules.practice.schemas import PracticeSessionScope
from app.processing.engines.practice_alignment.follow_policy import (
    PracticeScopeInvalidRange,
    PracticeScopeTargetNotFound,
)
from app.processing.engines.practice_alignment.musicxml_stable_ids import (
    prepare_musicxml_ids_for_practice,
)
from app.processing.engines.practice_alignment.target_catalog import (
    PracticeTargetCatalog,
    practice_target_catalog_from_musicxml,
)
from app.modules.practice.repository import PracticeRepository
from app.modules.practice.schemas import (
    PracticeReadyScoreContentRead,
    PracticeSessionResultSummaryRead,
    PracticeSessionDetailRead,
    PracticeSessionStartRead,
    PracticeTargetCatalogRead,
    PracticeTargetRead,
)
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_access.policy import ScoreAccessContext, ScoreAccessPolicy, ScoreAction
from app.modules.scores.repository import ScoreRepository
from app.modules.library.service import LibraryService
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from app.processing.engines.practice_alignment.attempt_assembler import ResolvedPracticeAttempt
    from app.processing.engines.practice_alignment.contracts import AlignmentUpdate


class PracticeService:
    """Service boundary for practice-session orchestration."""

    def __init__(
        self,
        repository: PracticeRepository | None = None,
        runtime_registry: PracticeSessionRuntimeRegistry | None = None,
        summary_builder: PracticeSessionSummaryBuilder | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        score_repository: ScoreRepository | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        library_service: LibraryService | None = None,
        storage: FileStorage | None = None,
        read_model: PracticeReadModel | None = None,
    ) -> None:
        self.repository = repository or PracticeRepository()
        self.runtime_registry = runtime_registry or practice_runtime_registry
        self.summary_builder = summary_builder or practice_session_summary_builder
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
        progression_mode: PracticeProgressionMode = PracticeProgressionMode.CONTINUOUS,
        realtime_guidance: PracticeRealtimeGuidance = PracticeRealtimeGuidance.STATUS_ONLY,
        evaluation_profile: PracticeEvaluationProfile = PracticeEvaluationProfile.PERFORMANCE,
        input_source: PracticeInputSource = PracticeInputSource.MICROPHONE,
        practice_scope: PracticeSessionScope | None = None,
    ) -> PracticeSessionStartRead:
        self._validate_session_policy(
            progression_mode=progression_mode,
            realtime_guidance=realtime_guidance,
            evaluation_profile=evaluation_profile,
            input_source=input_source,
            practice_scope=practice_scope,
        )
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
            progression_mode=progression_mode,
            realtime_guidance=realtime_guidance,
            evaluation_profile=evaluation_profile,
            input_source=input_source,
            scope_start_expected_group_id=(
                practice_scope.start_expected_group_id if practice_scope else None
            ),
            scope_end_expected_group_id=(
                practice_scope.end_expected_group_id if practice_scope else None
            ),
            scope_start_measure_number=(
                practice_scope.start_measure_number if practice_scope else None
            ),
            scope_end_measure_number=(
                practice_scope.end_measure_number if practice_scope else None
            ),
            sample_rate=sample_rate,
            channels=channels,
            frame_format=frame_format,
            summary_status=PracticeSessionSummaryStatus.NOT_REQUESTED,
        )
        session = await self.repository.create_session(db, session)
        return self.read_model.to_session_start(session)

    async def get_session_detail(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionDetailRead:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        return await self.read_model.to_session_detail(db, session)

    async def list_practice_targets(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        revision_uuid: str | None,
    ) -> PracticeTargetCatalogRead:
        access, score_file_path = await self._practice_musicxml_path(
            db,
            score_uuid=score_uuid,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        try:
            catalog = await asyncio.to_thread(
                practice_target_catalog_from_musicxml,
                score_file_path,
            )
        except Exception as exc:
            logger.bind(
                event="practice.target_catalog.failed",
                score_id=access.score.score_uuid,
                revision_id=access.revision.revision_uuid,
            ).opt(exception=exc).warning("Practice target catalog generation failed")
            raise ExternalServiceException(
                service="practice_target_catalog",
                code=ErrorCode.PRACTICE_ALIGNMENT_FAILED,
            ) from exc

        return self._target_catalog_read(
            access.score.score_uuid,
            access.revision.revision_uuid,
            catalog,
        )

    async def get_practice_ready_score_content(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        revision_uuid: str,
    ) -> PracticeReadyScoreContentRead:
        access, score_file_path = await self._practice_musicxml_path(
            db,
            score_uuid=score_uuid,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        try:
            source_xml = await asyncio.to_thread(score_file_path.read_text, encoding="utf-8")
            prepared_xml = await asyncio.to_thread(prepare_musicxml_ids_for_practice, source_xml)
        except Exception as exc:
            logger.bind(
                event="practice.ready_score_content.failed",
                score_id=access.score.score_uuid,
                revision_id=access.revision.revision_uuid,
            ).opt(exception=exc).warning("Practice ready score content generation failed")
            raise ExternalServiceException(
                service="practice_ready_score_content",
                code=ErrorCode.PRACTICE_ALIGNMENT_FAILED,
            ) from exc

        return PracticeReadyScoreContentRead(
            score_id=access.score.score_uuid,
            revision_id=access.revision.revision_uuid,
            content=prepared_xml,
        )

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
                progression_mode=session.progression_mode.value,
                realtime_guidance=session.realtime_guidance.value,
                evaluation_profile=session.evaluation_profile.value,
                input_source=session.input_source.value,
                start_expected_group_id=session.scope_start_expected_group_id,
                end_expected_group_id=session.scope_end_expected_group_id,
            )
        except Exception as exc:
            if isinstance(exc, PracticeScopeTargetNotFound):
                logger.bind(
                    event="practice.session_runtime.scope_target_not_found",
                    score_id=score.score_uuid,
                    session_id=session.session_uuid,
                    revision_id=revision.revision_uuid,
                    expected_group_id=exc.expected_group_id,
                ).warning("Practice session scoped target not found")
                session.state = PracticeSessionState.FAILED
                session.error = str(exc)
                await self.repository.save_session(db, session)
                raise ValidationException(
                    code=ErrorCode.PRACTICE_SCOPE_TARGET_NOT_FOUND,
                    field="practice_scope",
                    details={"expected_group_id": exc.expected_group_id},
                ) from exc
            if isinstance(exc, PracticeScopeInvalidRange):
                logger.bind(
                    event="practice.session_runtime.scope_invalid_range",
                    score_id=score.score_uuid,
                    session_id=session.session_uuid,
                    revision_id=revision.revision_uuid,
                    start_expected_group_id=session.scope_start_expected_group_id,
                    end_expected_group_id=session.scope_end_expected_group_id,
                ).warning("Practice session scoped range is invalid")
                session.state = PracticeSessionState.FAILED
                session.error = str(exc)
                await self.repository.save_session(db, session)
                raise ValidationException(
                    code=ErrorCode.PRACTICE_SCOPE_INVALID,
                    field="practice_scope",
                    details={
                        "start_expected_group_id": session.scope_start_expected_group_id,
                        "end_expected_group_id": session.scope_end_expected_group_id,
                    },
                ) from exc
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
        await self.finalize_pending_practice_attempts(
            db,
            session_uuid,
            reason="practice_paused",
        )
        session.state = PracticeSessionState.PAUSED
        session = await self.repository.save_session(db, session)
        self._update_runtime_state(session.session_uuid, session.state.value)
        runtime = self.runtime_registry.get(session.session_uuid)
        if runtime is not None:
            runtime.reset_input_buffer()
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
        await self.finalize_pending_practice_attempts(
            db,
            session_uuid,
            reason="practice_finished",
        )
        session.state = PracticeSessionState.FINISHED
        session.finished_at = utc_now_naive()
        session = await self.repository.save_session(db, session)
        session = await self._build_summary_for_finished_session(db, session)
        await self.library_service.mark_practiced(db, user_id, session.score_id)
        await db.commit()
        self.runtime_registry.release(session.session_uuid)
        return await self.read_model.to_session_detail(db, session)

    async def _build_summary_for_finished_session(
        self,
        db: AsyncSession,
        session: PracticeSession,
    ) -> PracticeSession:
        session.summary_status = PracticeSessionSummaryStatus.PENDING

        try:
            session_id = require_persisted_id(session.id, entity="practice session")
            attempts = await self.repository.list_attempts_for_session(db, session_id)
            summary_payload = self.summary_builder.build(session, attempts)
        except Exception as exc:
            session.summary_status = PracticeSessionSummaryStatus.FAILED
            session.summary_payload = json.dumps({"summary": "Practice summary generation failed."})
            session.error = str(exc)
        else:
            session.summary_status = PracticeSessionSummaryStatus.READY
            session.summary_payload = json.dumps(summary_payload)
            session.error = None
        return await self.repository.save_session(db, session)

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

    async def persist_practice_attempt(
        self,
        db: AsyncSession,
        session_uuid: str,
        resolved_attempt: "ResolvedPracticeAttempt",
    ) -> None:
        session = await self.repository.get_session_by_uuid(db, session_uuid)
        if not session:
            raise ResourceNotFoundException(
                resource_type="practice_session",
                resource_id=session_uuid,
                code=ErrorCode.PRACTICE_SESSION_NOT_FOUND,
            )
        session_id = require_persisted_id(session.id, entity="practice session")
        attempt = self._practice_attempt_from_resolved(
            session=session,
            session_id=session_id,
            resolved_attempt=resolved_attempt,
        )
        attempt.attempt_index = await self.repository.next_attempt_index(db, session_id)
        await self.repository.create_attempt_if_absent(db, attempt)

    async def finalize_pending_practice_attempts(
        self,
        db: AsyncSession,
        session_uuid: str,
        *,
        reason: Literal["practice_paused", "practice_finished", "connection_closed"],
    ) -> None:
        runtime = self.runtime_registry.get(session_uuid)
        if runtime is None:
            return

        for resolved_attempt in runtime.finalize_pending_practice_attempt(reason=reason):
            await self.persist_practice_attempt(db, session_uuid, resolved_attempt)

    async def get_summary(
        self,
        db: AsyncSession,
        session_uuid: str,
        user_id: int,
    ) -> PracticeSessionResultSummaryRead:
        session = await self._require_session_for_user(db, session_uuid, user_id)
        return self.read_model.to_session_summary_result(session)

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

    def _practice_attempt_from_resolved(
        self,
        *,
        session: PracticeSession,
        session_id: int,
        resolved_attempt: "ResolvedPracticeAttempt",
    ) -> PracticeAttempt:
        display_anchor = resolved_attempt.display_anchor
        expected_group_id = display_anchor["group_id"]
        render_note_ids = display_anchor.get("render_note_ids")
        outcome = resolved_attempt.outcome

        return PracticeAttempt(
            session_id=session_id,
            attempt_index=0,
            attempt_uid=outcome.snapshot.attempt_id,
            started_at_ms=outcome.snapshot.started_at_ms,
            resolved_at_ms=outcome.snapshot.resolved_at_ms,
            expected_group_id=expected_group_id,
            event_id=display_anchor.get("event_id"),
            beat_position=resolved_attempt.beat_position,
            render_note_ids=json.dumps(render_note_ids) if render_note_ids else None,
            measure_numbers=(
                json.dumps(list(resolved_attempt.measure_numbers))
                if resolved_attempt.measure_numbers
                else None
            ),
            result=_attempt_result_for_evaluation(outcome.evaluation.result),
            action=resolved_attempt.action,
            completion_status=_completion_status_for_resolution_reason(
                resolved_attempt.resolution_reason
            ),
            resolution_reason=_attempt_resolution_reason(resolved_attempt.resolution_reason),
            experience_state=resolved_attempt.experience_state,
            input_source=session.input_source,
            evidence_profile=_evidence_profile_for_session(session),
            correctness_scope=_correctness_scope_for_session(session),
            evaluator_version=outcome.evaluation.evaluator_version,
            policy_profile_version=outcome.policy_profile_version,
            confidence=resolved_attempt.confidence,
            validation_confidence=resolved_attempt.validation_confidence,
            input_policy_confidence=resolved_attempt.input_policy_confidence,
            timestamp_ms=resolved_attempt.timestamp_ms,
        )

    def _validate_session_policy(
        self,
        *,
        progression_mode: PracticeProgressionMode,
        realtime_guidance: PracticeRealtimeGuidance,
        evaluation_profile: PracticeEvaluationProfile,
        input_source: PracticeInputSource,
        practice_scope: PracticeSessionScope | None = None,
    ) -> None:
        if progression_mode == PracticeProgressionMode.CONTINUOUS:
            if input_source != PracticeInputSource.MICROPHONE:
                raise ValidationException(field="input_source")
            return
        if progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE:
            if realtime_guidance != PracticeRealtimeGuidance.GUIDED:
                raise ValidationException(field="realtime_guidance")
            if evaluation_profile != PracticeEvaluationProfile.LEARNING:
                raise ValidationException(field="evaluation_profile")
            if input_source not in {PracticeInputSource.MICROPHONE, PracticeInputSource.MIDI}:
                raise ValidationException(field="input_source")
            return
        raise ValidationException(field="progression_mode")

    @staticmethod
    def _target_catalog_read(
        score_uuid: str,
        revision_uuid: str,
        catalog: PracticeTargetCatalog,
    ) -> PracticeTargetCatalogRead:
        return PracticeTargetCatalogRead(
            score_id=score_uuid,
            revision_id=revision_uuid,
            targets=[
                PracticeTargetRead(
                    index=target.index,
                    group_id=target.group_id,
                    onset_beat=target.onset_beat,
                    event_ids=list(target.event_ids),
                    render_note_ids=list(target.render_note_ids),
                    pitches=list(target.pitches),
                    measure_numbers=list(target.measure_numbers),
                    staff_ids=list(target.staff_ids),
                    voice_ids=list(target.voice_ids),
                )
                for target in catalog.targets
            ],
        )

    async def _practice_musicxml_path(
        self,
        db: AsyncSession,
        *,
        score_uuid: str,
        user_id: int,
        revision_uuid: str | None,
    ) -> tuple[ScoreAccessContext, Path]:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision_id = require_persisted_id(access.revision.id, entity="score revision")
        source = await self.asset_repository.canonical_source(db, revision_id)
        if not source:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)

        return access, Path(
            self.storage.materialize_to_local(
                source.storage_key,
                self.storage.local_path(source.storage_key),
            )
        )


def _attempt_result_for_evaluation(result: str) -> PracticeAttemptResult:
    if result == "MATCH":
        return PracticeAttemptResult.MATCH
    if result == "PARTIAL":
        return PracticeAttemptResult.PARTIAL
    if result == "MISMATCH":
        return PracticeAttemptResult.MISMATCH
    if result == "UNCERTAIN":
        return PracticeAttemptResult.UNCERTAIN
    return PracticeAttemptResult.OTHER


def _attempt_resolution_reason(reason: str) -> PracticeAttemptResolutionReason:
    return PracticeAttemptResolutionReason(reason)


def _completion_status_for_resolution_reason(reason: str) -> PracticeAttemptCompletionStatus:
    if reason in {"practice_paused", "practice_finished", "connection_closed"}:
        return PracticeAttemptCompletionStatus.INTERRUPTED
    return PracticeAttemptCompletionStatus.COMPLETED


def _evidence_profile_for_session(session: PracticeSession) -> str:
    if session.input_source == PracticeInputSource.MIDI:
        return "MIDI_STRICT"
    if session.progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE:
        return "MICROPHONE_BEST_EFFORT"
    return "MICROPHONE_ALIGNMENT"


def _correctness_scope_for_session(session: PracticeSession) -> str:
    if session.input_source == PracticeInputSource.MIDI:
        return "symbolic_exact_notes"
    if session.progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE:
        return "acoustic_single_note_strict_chord_best_effort"
    return "continuous_alignment_diagnostics"
