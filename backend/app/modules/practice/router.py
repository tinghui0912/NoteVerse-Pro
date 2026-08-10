"""Realtime practice routes under the practice module boundary."""

import time

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.exceptions import AppException
from app.core.logger import logger
from app.core.metrics import realtime_connection_closed, realtime_connection_opened
from app.db.models import User
from app.db.model_utils import require_persisted_id
from app.modules.practice.dependencies import get_practice_service, get_websocket_current_user
from app.modules.practice.schemas import (
    CreatePracticeSessionRequest,
    PracticeReportRead,
    PracticeSessionDetailRead,
    PracticeSessionSummaryRead,
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
from app.shared.constants import ErrorCode, SuccessCode
from app.shared.responses import APIResponse, success_response

router = APIRouter()


@router.post("/sessions", response_model=APIResponse[PracticeSessionSummaryRead])
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
    )
    return success_response(data=result, message=SuccessCode.PRACTICE_SESSION_CREATED)


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
    result = await practice_service.finish_session(db, session_id, user_id)
    return success_response(data=result, message=SuccessCode.PRACTICE_SESSION_FINISHED)


@router.post("/sessions/{session_id}/report", response_model=APIResponse[PracticeReportRead])
async def request_practice_report(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.request_report(db, session_id, user_id)
    return success_response(data=result, message=SuccessCode.PRACTICE_REPORT_READY)


@router.get("/sessions/{session_id}/report", response_model=APIResponse[PracticeReportRead])
async def get_practice_report(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_service.get_report(db, session_id, user_id)
    return success_response(data=result)


@router.websocket("/sessions/{session_id}/stream")
async def stream_practice_session(
    websocket: WebSocket,
    session_id: str,
    db: AsyncSession = Depends(get_db),
    practice_service: PracticeService = Depends(get_practice_service),
):
    started_at = time.monotonic()
    user_id: int | None = None
    terminal_event = "practice.websocket.closed"
    terminal_fields: dict[str, object] = {}
    accepted = False

    try:
        current_user = await get_websocket_current_user(websocket, db)
        user_id = require_persisted_id(current_user.id, entity="user")
        await practice_service.require_session_access(db, session_id, user_id)

        await websocket.accept()
        accepted = True
        realtime_connection_opened(channel="practice_websocket")
        logger.bind(
            event="practice.websocket.accepted",
            operation_kind="practice",
            session_id=session_id,
            user_id=user_id,
        ).info("practice websocket accepted")
        await websocket.send_json(session_connecting_message(session_id))
        runtime = await practice_service.prepare_stream_runtime(db, session_id, user_id)
        runtime.websocket = websocket
        logger.bind(
            event="practice.websocket.ready",
            operation_kind="practice",
            session_id=session_id,
            user_id=user_id,
        ).info("practice websocket ready")

        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            text = message.get("text")
            if text is not None:
                try:
                    control = parse_control_message(text)
                except ValueError:
                    await websocket.send_json(
                        session_error_message(
                            public_code=ErrorCode.PRACTICE_STREAM_CLOSED,
                        )
                    )
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    break
                message_type = control.type

                if message_type == "client.init":
                    detail = await practice_service.start_session_stream(db, session_id, user_id)
                    runtime.state = detail["state"]
                    await websocket.send_json(
                        session_ready_message(session_id=session_id, state=detail["state"])
                    )
                elif message_type == "client.pause":
                    if runtime.last_alignment is not None and runtime.pending_alignment_updates > 0:
                        await practice_service.persist_alignment(
                            db,
                            session_id,
                            runtime.last_alignment,
                        )
                        runtime.mark_alignment_persisted()
                    detail = await practice_service.pause_session(db, session_id, user_id)
                    runtime.state = detail["state"]
                    await websocket.send_json(state_changed_message(detail["state"]))
                elif message_type == "client.resume":
                    detail = await practice_service.resume_session(db, session_id, user_id)
                    runtime.state = detail["state"]
                    await websocket.send_json(state_changed_message(detail["state"]))
                elif message_type == "client.finish":
                    if runtime.last_alignment is not None and runtime.pending_alignment_updates > 0:
                        await practice_service.persist_alignment(
                            db,
                            session_id,
                            runtime.last_alignment,
                        )
                        runtime.mark_alignment_persisted()
                    detail = await practice_service.finish_session(db, session_id, user_id)
                    runtime.state = detail["state"]
                    await websocket.send_json(session_finished_message(detail["state"]))
                    break
                elif message_type == "client.heartbeat":
                    continue
                else:
                    await websocket.send_json(
                        session_error_message(
                            public_code=ErrorCode.PRACTICE_STREAM_CLOSED,
                        )
                    )
            binary_payload = message.get("bytes")
            if binary_payload is not None:
                if runtime.state != "STREAMING":
                    continue
                try:
                    alignment = runtime.process_audio_chunk(binary_payload)
                except RuntimeError:
                    await websocket.send_json(
                        session_error_message(
                            public_code=ErrorCode.PRACTICE_ALIGNMENT_FAILED,
                        )
                    )
                    break

                if runtime.consume_ready_notification():
                    await websocket.send_json(
                        session_armed_message(
                            session_id=session_id,
                            environment_quality=runtime.environment_quality,
                        )
                    )

                if alignment is not None:
                    await websocket.send_json(alignment_update_message(alignment))
                    if runtime.should_persist_alignment():
                        await practice_service.persist_alignment(db, session_id, alignment)
                        runtime.mark_alignment_persisted()
                    if runtime.is_score_completed():
                        if runtime.pending_alignment_updates > 0:
                            await practice_service.persist_alignment(db, session_id, alignment)
                            runtime.mark_alignment_persisted()
                        detail = await practice_service.finish_session(db, session_id, user_id)
                        runtime.state = detail["state"]
                        await websocket.send_json(session_finished_message(detail["state"]))
                        break

    except AppException as exc:
        terminal_event = "practice.websocket.failed"
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
        terminal_fields = {"status_code": exc.code}
    except Exception as exc:
        terminal_event = "practice.websocket.failed"
        terminal_fields = {
            "public_code": ErrorCode.PRACTICE_STREAM_CLOSED,
            "exception_type": type(exc).__name__,
        }
        if not accepted:
            await websocket.accept()
            accepted = True
            realtime_connection_opened(channel="practice_websocket")
        await websocket.send_json(
            session_error_message(public_code=ErrorCode.PRACTICE_STREAM_CLOSED)
        )
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
    finally:
        cleanup_runtime = practice_service.runtime_registry.get(session_id)
        if cleanup_runtime is not None and cleanup_runtime.websocket is websocket:
            cleanup_runtime.websocket = None
        if accepted:
            realtime_connection_closed(channel="practice_websocket")
        logger.bind(
            event=terminal_event,
            operation_kind="practice",
            session_id=session_id,
            user_id=user_id,
            duration_ms=round((time.monotonic() - started_at) * 1000),
            **terminal_fields,
        ).info("practice websocket terminal event")
