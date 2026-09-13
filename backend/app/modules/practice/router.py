"""Realtime practice routes under the practice module boundary."""

import time

from fastapi import APIRouter, Depends, Header, Query, Request, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.exceptions import AppException
from app.core.logger import logger
from app.core.metrics import realtime_connection_closed, realtime_connection_opened
from app.db.models import User
from app.db.models.practice import PracticeSessionCompletionReason
from app.db.model_utils import require_persisted_id
from app.modules.practice.dependencies import get_practice_service, get_websocket_current_user
from app.modules.practice.performance_stream import run_performance_session_loop
from app.modules.practice.schemas import (
    CreatePracticeSessionRequest,
    PracticeReplayFinalizeRequest,
    PracticeReplayUploadAuthorizationRead,
    PracticeReplayUploadAuthorizationRequest,
    PracticeReadyScoreContentRead,
    PracticeSessionResultSummaryRead,
    PracticeSessionDetailRead,
    PracticeSessionStartRead,
    PracticeTargetCatalogRead,
    SavedPracticeReplayPlaybackRead,
    SavedPracticeReplayArtifactRead,
    SavedPracticePerformanceRead,
)
from app.modules.practice.service import PracticeService
from app.processing.realtime.message_codec import (
    alignment_update_message,
    parse_control_message,
    session_armed_message,
    session_connecting_message,
    session_error_message,
    session_finished_message,
    session_ready_message,
    state_changed_message,
)
from app.processing.realtime.protocol import ClientInitPayload
from app.processing.realtime.session_runtime import (
    PerformancePracticeSessionRuntime,
    PracticeRuntime,
    PracticeSessionRuntime,
)
from app.shared.constants import ErrorCode, SuccessCode
from app.shared.responses import APIResponse, success_response

router = APIRouter()

_CLIENT_INIT_POLICY_FIELDS = (
    "progression_mode",
    "realtime_guidance",
    "evaluation_profile",
    "input_source",
)


async def _send_alignment_and_finish_if_needed(
    *,
    websocket: WebSocket,
    db: AsyncSession,
    practice_service: PracticeService,
    runtime: PracticeSessionRuntime,
    session_id: str,
    user_id: int,
    alignment,
) -> str | None:
    for resolved_attempt in runtime.drain_resolved_practice_attempts():
        await practice_service.persist_practice_attempt(db, session_id, resolved_attempt)

    if not runtime.is_scope_completed():
        await websocket.send_json(alignment_update_message(alignment))
        if runtime.should_persist_alignment():
            await practice_service.persist_alignment(db, session_id, alignment)
            runtime.mark_alignment_persisted()
        return None

    if runtime.pending_alignment_updates > 0:
        await practice_service.persist_alignment(db, session_id, alignment)
        runtime.mark_alignment_persisted()
    detail = await practice_service.finish_session(
        db,
        session_id,
        user_id,
        completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
    )
    state = _practice_session_state_value(detail)
    runtime.state = state
    await websocket.send_json(alignment_update_message(alignment))
    await websocket.send_json(
        session_finished_message(
            state,
            _practice_session_completion_outcome_value(detail),
        )
    )
    try:
        await practice_service.build_summary_for_finished_session(db, session_id, user_id)
    except Exception as exc:
        logger.bind(
            event="practice.websocket.summary_build_failed",
            operation_kind="practice",
            session_id=session_id,
            user_id=user_id,
            exception_type=type(exc).__name__,
        ).opt(exception=exc).warning("practice websocket summary build failed after session finished")
    return state


def _client_init_policy_mismatch(
    payload: ClientInitPayload,
    runtime: PracticeRuntime,
) -> dict[str, object] | None:
    for field_name in _CLIENT_INIT_POLICY_FIELDS:
        expected = str(getattr(runtime, field_name))
        actual = str(getattr(payload, field_name))
        if actual != expected:
            return {"field": field_name, "expected": expected, "actual": actual}
    return None


def _practice_session_state_value(detail: PracticeSessionDetailRead) -> str:
    return detail.state.value


def _practice_session_completion_outcome_value(
    detail: PracticeSessionDetailRead,
) -> dict[str, object]:
    if detail.completion_outcome is None:
        raise RuntimeError("finished practice session is missing completion outcome")
    return detail.completion_outcome.model_dump(mode="json")


@router.post("/sessions", response_model=APIResponse[PracticeSessionStartRead])
async def create_practice_session(
    request: CreatePracticeSessionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.create_session(
        db,
        score_uuid=request.score_id,
        user_id=user_id,
        revision_uuid=request.revision_id,
        sample_rate=request.sample_rate,
        channels=request.channels,
        frame_format=request.frame_format,
        preset=request.preset,
        input_source=request.input_source,
        practice_scope=request.practice_scope,
    )
    return success_response(data=result, message=SuccessCode.PRACTICE_SESSION_CREATED)


@router.get(
    "/scores/{score_id}/revisions/{revision_id}/targets",
    response_model=APIResponse[PracticeTargetCatalogRead],
)
async def list_practice_targets(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.list_practice_targets(db, score_id, user_id, revision_id)
    return success_response(data=result)


@router.get(
    "/scores/{score_id}/revisions/{revision_id}/content",
    response_model=APIResponse[PracticeReadyScoreContentRead],
)
async def get_practice_ready_score_content(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.get_practice_ready_score_content(
        db,
        score_id,
        user_id,
        revision_id,
    )
    return success_response(data=result)


@router.get(
    "/scores/{score_id}/saved-performances",
    response_model=APIResponse[list[SavedPracticePerformanceRead]],
)
async def list_saved_practice_performances(
    score_id: str,
    limit: int = Query(10, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.list_saved_performances(
        db,
        score_id,
        user_id,
        limit=limit,
    )
    return success_response(data=result)


@router.get("/sessions/{session_id}", response_model=APIResponse[PracticeSessionDetailRead])
async def get_practice_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.get_session_detail(db, session_id, user_id)
    return success_response(data=result)


@router.post("/sessions/{session_id}/pause", response_model=APIResponse[PracticeSessionDetailRead])
async def pause_practice_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.pause_session(db, session_id, user_id)
    return success_response(data=result, message=SuccessCode.PRACTICE_SESSION_PAUSED)


@router.post("/sessions/{session_id}/resume", response_model=APIResponse[PracticeSessionDetailRead])
async def resume_practice_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.resume_session(db, session_id, user_id)
    return success_response(data=result, message=SuccessCode.PRACTICE_SESSION_RESUMED)


@router.post("/sessions/{session_id}/finish", response_model=APIResponse[PracticeSessionDetailRead])
async def finish_practice_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.finish_session(
        db,
        session_id,
        user_id,
        completion_reason=PracticeSessionCompletionReason.STOPPED_BY_USER,
    )
    result = await practice_service.build_summary_for_finished_session(db, session_id, user_id)
    return success_response(data=result, message=SuccessCode.PRACTICE_SESSION_FINISHED)


@router.get("/sessions/{session_id}/summary", response_model=APIResponse[PracticeSessionResultSummaryRead])
async def get_practice_session_summary(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.get_summary(db, session_id, user_id)
    return success_response(data=result)


@router.post(
    "/sessions/{session_id}/replay-upload-authorizations",
    response_model=APIResponse[PracticeReplayUploadAuthorizationRead],
)
async def authorize_practice_replay_upload(
    session_id: str,
    request: PracticeReplayUploadAuthorizationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.authorize_replay_upload(
        db,
        session_id,
        user_id,
        request=request,
    )
    return success_response(data=result)


@router.put("/sessions/{session_id}/replay-uploads/{artifact_id}")
async def upload_practice_replay_object_for_local_storage(
    session_id: str,
    artifact_id: str,
    request: Request,
    x_noteverse_content_sha256: str = Header(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    await practice_service.upload_replay_object_for_local_storage(
        db,
        session_id,
        user_id,
        artifact_id,
        content=await request.body(),
        content_type=request.headers.get("content-type", "application/octet-stream"),
        checksum_sha256=x_noteverse_content_sha256,
    )
    return success_response(data={"uploaded": True})


@router.post(
    "/sessions/{session_id}/replay-artifacts",
    response_model=APIResponse[SavedPracticeReplayArtifactRead],
)
async def finalize_practice_replay_artifact(
    session_id: str,
    request: PracticeReplayFinalizeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.finalize_replay_artifact(
        db,
        session_id,
        user_id,
        request=request,
    )
    return success_response(data=result, message=SuccessCode.PRACTICE_REPLAY_SAVED)


@router.get(
    "/sessions/{session_id}/replay-artifacts",
    response_model=APIResponse[list[SavedPracticeReplayArtifactRead]],
)
async def list_practice_replay_artifacts(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.list_replay_artifacts(db, session_id, user_id)
    return success_response(data=result)


@router.get(
    "/sessions/{session_id}/replay-artifacts/{artifact_id}/playback-url",
    response_model=APIResponse[SavedPracticeReplayPlaybackRead],
)
async def get_practice_replay_artifact_playback_url(
    session_id: str,
    artifact_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.get_replay_artifact_playback(
        db,
        session_id,
        user_id,
        artifact_id,
    )
    return success_response(data=result)

@router.delete(
    "/sessions/{session_id}/replay-artifacts/{artifact_id}",
    response_model=APIResponse[SavedPracticeReplayArtifactRead],
)
async def delete_practice_replay_artifact(
    session_id: str,
    artifact_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.delete_replay_artifact(db, session_id, user_id, artifact_id)
    return success_response(data=result, message=SuccessCode.DELETE_SUCCESS)

@router.websocket("/sessions/{session_id}/stream")
async def stream_practice_session(
    websocket: WebSocket,
    session_id: str,
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    started_at = time.monotonic()
    phase = "authenticating"
    user_id: int | None = None
    terminal_event = "practice.websocket.closed"
    terminal_reason = "loop_exited"
    terminal_fields: dict[str, object] = {}
    accepted = False
    runtime = None

    try:
        current_user = await get_websocket_current_user(websocket, db)
        user_id = require_persisted_id(current_user.id, entity="user")
        await practice_service.require_session_access(db, session_id, user_id)

        phase = "accepting"
        await websocket.accept()
        accepted = True
        phase = "accepted"
        realtime_connection_opened(channel="practice_websocket")
        logger.bind(
            event="practice.websocket.accepted",
            operation_kind="practice",
            session_id=session_id,
            user_id=user_id,
        ).info("practice websocket accepted")
        await websocket.send_json(session_connecting_message(session_id))

        phase = "preparing_runtime"
        prepare_started_at = time.monotonic()
        logger.bind(
            event="practice.websocket.runtime_preparing",
            operation_kind="practice",
            session_id=session_id,
            user_id=user_id,
        ).info("practice websocket runtime preparing")
        runtime = await practice_service.prepare_stream_runtime(db, session_id, user_id)
        runtime.websocket = websocket
        prepare_ms = round((time.monotonic() - prepare_started_at) * 1000)
        phase = "waiting_for_client_init"
        logger.bind(
            event="practice.websocket.ready",
            operation_kind="practice",
            session_id=session_id,
            user_id=user_id,
            prepare_ms=prepare_ms,
            state=runtime.state,
            sample_rate=runtime.sample_rate,
            channels=runtime.channels,
            frame_format=runtime.frame_format,
            progression_mode=runtime.progression_mode,
            realtime_guidance=runtime.realtime_guidance,
            evaluation_profile=runtime.evaluation_profile,
            input_source=runtime.input_source,
        ).info("practice websocket ready")

        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                terminal_event = "practice.websocket.disconnected"
                terminal_reason = "client_disconnected"
                terminal_fields = {"status_code": message.get("code")}
                break

            text = message.get("text")
            if text is not None:
                try:
                    control = parse_control_message(text)
                except ValueError:
                    terminal_event = "practice.websocket.failed"
                    terminal_reason = "invalid_control_message"
                    terminal_fields = {"public_code": ErrorCode.PRACTICE_STREAM_CLOSED}
                    logger.bind(
                        event="practice.websocket.control_rejected",
                        operation_kind="practice",
                        session_id=session_id,
                        user_id=user_id,
                        phase=phase,
                        reason=terminal_reason,
                    ).warning("practice websocket control rejected: reason=invalid_control_message")
                    await websocket.send_json(
                        session_error_message(
                            public_code=ErrorCode.PRACTICE_STREAM_CLOSED,
                        )
                    )
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    break
                message_type = control.type

                if message_type == "client.init":
                    phase = "client_init_received"
                    logger.bind(
                        event="practice.websocket.client_init",
                        operation_kind="practice",
                        session_id=session_id,
                        user_id=user_id,
                        sample_rate=control.payload.sample_rate,
                        channels=control.payload.channels,
                        frame_samples=control.payload.frame_samples,
                        progression_mode=control.payload.progression_mode,
                        realtime_guidance=control.payload.realtime_guidance,
                        evaluation_profile=control.payload.evaluation_profile,
                        input_source=control.payload.input_source,
                    ).info("practice websocket client.init received")
                    policy_mismatch = _client_init_policy_mismatch(control.payload, runtime)
                    if policy_mismatch is not None:
                        terminal_event = "practice.websocket.failed"
                        terminal_reason = "client_init_policy_mismatch"
                        terminal_fields = policy_mismatch
                        logger.bind(
                            event="practice.websocket.client_init_rejected",
                            operation_kind="practice",
                            session_id=session_id,
                            user_id=user_id,
                            **terminal_fields,
                        ).warning("practice websocket client.init rejected")
                        await websocket.send_json(
                            session_error_message(public_code=ErrorCode.VALIDATION_ERROR)
                        )
                        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                        break
                    if isinstance(runtime, PerformancePracticeSessionRuntime):
                        (
                            terminal_event,
                            terminal_reason,
                            terminal_fields,
                        ) = await run_performance_session_loop(
                            websocket=websocket,
                            db=db,
                            practice_service=practice_service,
                            runtime=runtime,
                            session_id=session_id,
                            user_id=user_id,
                        )
                        break
                    step_runtime = runtime
                    detail = await practice_service.start_session_stream(db, session_id, user_id)
                    state = _practice_session_state_value(detail)
                    step_runtime.state = state
                    await websocket.send_json(
                        session_ready_message(session_id=session_id, state=state)
                    )
                    if step_runtime.consume_ready_notification():
                        await websocket.send_json(
                            session_armed_message(
                                session_id=session_id,
                                input_health=step_runtime.input_health,
                            )
                        )
                    phase = "streaming"
                    logger.bind(
                        event="practice.websocket.session_ready_sent",
                        operation_kind="practice",
                        session_id=session_id,
                        user_id=user_id,
                        state=step_runtime.state,
                    ).info("practice websocket session.ready sent")
                elif message_type == "client.pause":
                    if isinstance(runtime, PerformancePracticeSessionRuntime):
                        continue
                    step_runtime = runtime
                    phase = "pausing"
                    if (
                        step_runtime.last_alignment is not None
                        and step_runtime.pending_alignment_updates > 0
                    ):
                        await practice_service.persist_alignment(
                            db,
                            session_id,
                            step_runtime.last_alignment,
                        )
                        step_runtime.mark_alignment_persisted()
                    detail = await practice_service.pause_session(db, session_id, user_id)
                    state = _practice_session_state_value(detail)
                    step_runtime.state = state
                    await websocket.send_json(state_changed_message(state))
                    phase = "paused"
                elif message_type == "client.resume":
                    if isinstance(runtime, PerformancePracticeSessionRuntime):
                        continue
                    step_runtime = runtime
                    phase = "resuming"
                    detail = await practice_service.resume_session(db, session_id, user_id)
                    state = _practice_session_state_value(detail)
                    step_runtime.state = state
                    await websocket.send_json(state_changed_message(state))
                    phase = "streaming"
                elif message_type == "client.finish":
                    if isinstance(runtime, PerformancePracticeSessionRuntime):
                        continue
                    step_runtime = runtime
                    phase = "finishing"
                    if (
                        step_runtime.last_alignment is not None
                        and step_runtime.pending_alignment_updates > 0
                    ):
                        await practice_service.persist_alignment(
                            db,
                            session_id,
                            step_runtime.last_alignment,
                        )
                        step_runtime.mark_alignment_persisted()
                    detail = await practice_service.finish_session(
                        db,
                        session_id,
                        user_id,
                        completion_reason=PracticeSessionCompletionReason.STOPPED_BY_USER,
                    )
                    state = _practice_session_state_value(detail)
                    step_runtime.state = state
                    await websocket.send_json(
                        session_finished_message(
                            state,
                            _practice_session_completion_outcome_value(detail),
                        )
                    )
                    await practice_service.build_summary_for_finished_session(
                        db,
                        session_id,
                        user_id,
                    )
                    terminal_event = "practice.websocket.finished"
                    terminal_reason = "client_finished"
                    terminal_fields = {"state": step_runtime.state}
                    break
                elif message_type == "client.skip":
                    if isinstance(runtime, PerformancePracticeSessionRuntime):
                        continue
                    step_runtime = runtime
                    if step_runtime.state != "STREAMING":
                        continue
                    phase = "streaming_skip"
                    try:
                        alignment = step_runtime.skip_current_expected_group()
                    except RuntimeError:
                        terminal_event = "practice.websocket.failed"
                        terminal_reason = "skip_processing_failed"
                        terminal_fields = {"public_code": ErrorCode.PRACTICE_ALIGNMENT_FAILED}
                        await websocket.send_json(
                            session_error_message(
                                public_code=ErrorCode.PRACTICE_ALIGNMENT_FAILED,
                            )
                        )
                        break

                    if alignment is not None:
                        finished_state = await _send_alignment_and_finish_if_needed(
                            websocket=websocket,
                            db=db,
                            practice_service=practice_service,
                            runtime=step_runtime,
                            session_id=session_id,
                            user_id=user_id,
                            alignment=alignment,
                        )
                        if finished_state is not None:
                            terminal_event = "practice.websocket.finished"
                            terminal_reason = "scope_completed"
                            terminal_fields = {"state": finished_state}
                            break
                elif message_type == "client.heartbeat":
                    continue
                elif message_type == "client.midi_event":
                    if isinstance(runtime, PerformancePracticeSessionRuntime):
                        continue
                    step_runtime = runtime
                    if step_runtime.state != "STREAMING":
                        continue
                    phase = "streaming_midi"
                    try:
                        alignment = step_runtime.process_midi_event(
                            event_type=control.payload.event_type,
                            note_number=control.payload.note_number,
                            velocity=control.payload.velocity,
                            timestamp_ms=control.payload.timestamp_ms,
                        )
                    except RuntimeError:
                        terminal_event = "practice.websocket.failed"
                        terminal_reason = "midi_processing_failed"
                        terminal_fields = {"public_code": ErrorCode.PRACTICE_ALIGNMENT_FAILED}
                        await websocket.send_json(
                            session_error_message(
                                public_code=ErrorCode.PRACTICE_ALIGNMENT_FAILED,
                            )
                        )
                        break

                    if alignment is not None:
                        finished_state = await _send_alignment_and_finish_if_needed(
                            websocket=websocket,
                            db=db,
                            practice_service=practice_service,
                            runtime=step_runtime,
                            session_id=session_id,
                            user_id=user_id,
                            alignment=alignment,
                        )
                        if finished_state is not None:
                            terminal_event = "practice.websocket.finished"
                            terminal_reason = "scope_completed"
                            terminal_fields = {"state": finished_state}
                            break
                else:
                    terminal_event = "practice.websocket.failed"
                    terminal_reason = "unsupported_control_message"
                    terminal_fields = {"message_type": message_type}
                    await websocket.send_json(
                        session_error_message(
                            public_code=ErrorCode.PRACTICE_STREAM_CLOSED,
                        )
                    )
            binary_payload = message.get("bytes")
            if binary_payload is not None:
                if isinstance(runtime, PerformancePracticeSessionRuntime):
                    continue
                step_runtime = runtime
                if step_runtime.state != "STREAMING":
                    continue
                phase = "streaming_audio"
                try:
                    alignment = step_runtime.process_audio_chunk(binary_payload)
                except RuntimeError:
                    terminal_event = "practice.websocket.failed"
                    terminal_reason = "alignment_failed"
                    terminal_fields = {"public_code": ErrorCode.PRACTICE_ALIGNMENT_FAILED}
                    await websocket.send_json(
                        session_error_message(
                            public_code=ErrorCode.PRACTICE_ALIGNMENT_FAILED,
                        )
                    )
                    break

                if step_runtime.consume_ready_notification():
                    await websocket.send_json(
                        session_armed_message(
                            session_id=session_id,
                            input_health=step_runtime.input_health,
                        )
                    )

                if alignment is not None:
                    finished_state = await _send_alignment_and_finish_if_needed(
                        websocket=websocket,
                        db=db,
                        practice_service=practice_service,
                        runtime=step_runtime,
                        session_id=session_id,
                        user_id=user_id,
                        alignment=alignment,
                    )
                    if finished_state is not None:
                        terminal_event = "practice.websocket.finished"
                        terminal_reason = "scope_completed"
                        terminal_fields = {"state": finished_state}
                        break

    except AppException as exc:
        terminal_event = "practice.websocket.failed"
        terminal_reason = "application_exception"
        terminal_fields = {"public_code": exc.code, "exception_type": type(exc).__name__}
        if not accepted:
            await websocket.accept()
            accepted = True
            realtime_connection_opened(channel="practice_websocket")
        await websocket.send_json(
            session_error_message(
                public_code=exc.code,
            )
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    except WebSocketDisconnect as exc:
        terminal_event = "practice.websocket.disconnected"
        terminal_reason = "websocket_disconnect_exception"
        terminal_fields = {"status_code": exc.code}
    except Exception as exc:
        terminal_event = "practice.websocket.failed"
        terminal_reason = "unexpected_exception"
        terminal_fields = {
            "public_code": ErrorCode.PRACTICE_STREAM_CLOSED,
            "exception_type": type(exc).__name__,
        }
        logger.bind(
            event=terminal_event,
            operation_kind="practice",
            session_id=session_id,
            user_id=user_id,
            phase=phase,
            reason=terminal_reason,
            **terminal_fields,
        ).exception("practice websocket unexpected exception")
        if not accepted:
            await websocket.accept()
            accepted = True
            realtime_connection_opened(channel="practice_websocket")
        await websocket.send_json(
            session_error_message(public_code=ErrorCode.PRACTICE_STREAM_CLOSED)
        )
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
    finally:
        if runtime is not None and terminal_event != "practice.websocket.finished":
            try:
                await practice_service.finalize_pending_practice_attempts(
                    db,
                    session_id,
                    reason="connection_closed",
                )
            except Exception as exc:
                logger.bind(
                    event="practice.websocket.pending_attempt_finalize_failed",
                    operation_kind="practice",
                    session_id=session_id,
                    user_id=user_id,
                    phase=phase,
                    reason=terminal_reason,
                    exception_type=type(exc).__name__,
                ).opt(exception=exc).warning("practice websocket pending attempt finalize failed")
        cleanup_runtime = practice_service.runtime_registry.get(session_id)
        if cleanup_runtime is not None and cleanup_runtime.websocket is websocket:
            cleanup_runtime.websocket = None
        if accepted:
            realtime_connection_closed(channel="practice_websocket")
        duration_ms = round((time.monotonic() - started_at) * 1000)
        logger.bind(
            event=terminal_event,
            operation_kind="practice",
            session_id=session_id,
            user_id=user_id,
            duration_ms=duration_ms,
            phase=phase,
            reason=terminal_reason,
            **terminal_fields,
        ).info("practice websocket terminal event")
