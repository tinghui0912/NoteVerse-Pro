from __future__ import annotations

import asyncio
import time

from fastapi import WebSocket, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.practice import PracticeSessionCompletionReason
from app.modules.practice.schemas import PracticeSessionDetailRead
from app.modules.practice.service import PracticeService
from app.processing.realtime.message_codec import (
    parse_control_message,
    performance_clock_sync_message,
    performance_lifecycle_message,
    performance_timeline_message,
    session_error_message,
    session_finished_message,
    session_ready_message,
    state_changed_message,
)
from app.processing.performance.runtime import PerformanceClockSync
from app.processing.realtime.session_runtime import PerformancePracticeSessionRuntime
from app.shared.constants import ErrorCode


PERFORMANCE_CLOCK_SYNC_INTERVAL_SECONDS = 0.1


async def run_performance_session_loop(
    *,
    websocket: WebSocket,
    db: AsyncSession,
    practice_service: PracticeService,
    runtime: PerformancePracticeSessionRuntime,
    session_id: str,
    user_id: int,
) -> tuple[str, str, dict[str, object]]:
    detail = await practice_service.start_session_stream(db, session_id, user_id)
    state = _practice_session_state_value(detail)
    runtime.state = state
    await websocket.send_json(session_ready_message(session_id=session_id, state=state))
    await websocket.send_json(
        performance_timeline_message(runtime.performance_timeline_projection())
    )

    loop_started_at = time.monotonic()

    def now_ms() -> int:
        return max(0, round((time.monotonic() - loop_started_at) * 1000))

    started_sync = runtime.start_performance(now_ms=0)
    await websocket.send_json(performance_lifecycle_message("started", started_sync))
    await websocket.send_json(performance_clock_sync_message(started_sync))
    last_clock_sync_sent_ms = 0

    async def send_clock_sync_if_due() -> PerformanceClockSync:
        nonlocal last_clock_sync_sent_ms
        current_ms = now_ms()
        sync = runtime.performance_sync(now_ms=current_ms)
        if current_ms - last_clock_sync_sent_ms >= PERFORMANCE_CLOCK_SYNC_INTERVAL_SECONDS * 1000:
            await websocket.send_json(performance_clock_sync_message(sync))
            last_clock_sync_sent_ms = current_ms
        return sync

    async def finish_scope_if_completed(
        sync: PerformanceClockSync | None = None,
        sync_already_sent: bool = False,
    ) -> tuple[str, str, dict[str, object]] | None:
        current_ms = now_ms()
        sync = sync or runtime.performance_sync(now_ms=current_ms)
        if not sync.scope_completed:
            return None

        if not sync_already_sent:
            await websocket.send_json(performance_clock_sync_message(sync))
        await websocket.send_json(performance_lifecycle_message("ended", sync))
        runtime.finalize_performance_observations(now_ms=current_ms)
        outcomes = runtime.evaluate_expected_event_outcomes()
        detail = await practice_service.finish_session(
            db,
            session_id,
            user_id,
            completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
        )
        finished_state = _practice_session_state_value(detail)
        runtime.state = finished_state
        await websocket.send_json(
            session_finished_message(
                finished_state,
                _practice_session_completion_outcome_value(detail),
            )
        )
        await practice_service.build_summary_for_finished_session(
            db,
            session_id,
            user_id,
            performance_observations=runtime.performance_observations,
            performance_outcomes=outcomes,
        )
        return (
            "practice.websocket.finished",
            "performance_scope_completed",
            {"state": finished_state},
        )

    while True:
        try:
            message = await asyncio.wait_for(
                websocket.receive(),
                timeout=PERFORMANCE_CLOCK_SYNC_INTERVAL_SECONDS,
            )
        except TimeoutError:
            sync = runtime.performance_sync(now_ms=now_ms())
            await websocket.send_json(performance_clock_sync_message(sync))
            terminal = await finish_scope_if_completed(sync, sync_already_sent=True)
            if terminal is not None:
                return terminal
            continue

        if message["type"] == "websocket.disconnect":
            detail = await practice_service.fail_active_session_stream(
                db,
                session_id,
                user_id,
                reason="performance websocket disconnected before terminal boundary",
            )
            runtime.state = _practice_session_state_value(detail)
            return (
                "practice.websocket.failed",
                "client_disconnected",
                {"status_code": message.get("code"), "state": runtime.state},
            )

        text = message.get("text")
        if text is not None:
            try:
                control = parse_control_message(text)
            except ValueError:
                await websocket.send_json(
                    session_error_message(public_code=ErrorCode.PRACTICE_STREAM_CLOSED)
                )
                detail = await practice_service.fail_active_session_stream(
                    db,
                    session_id,
                    user_id,
                    reason="invalid performance control message",
                )
                runtime.state = _practice_session_state_value(detail)
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return (
                    "practice.websocket.failed",
                    "invalid_control_message",
                    {
                        "public_code": ErrorCode.PRACTICE_STREAM_CLOSED,
                        "state": runtime.state,
                    },
                )

            if control.type == "client.pause":
                detail = await practice_service.pause_session(db, session_id, user_id)
                state = _practice_session_state_value(detail)
                runtime.state = state
                sync = runtime.pause_performance(now_ms=now_ms())
                await websocket.send_json(performance_lifecycle_message("paused", sync))
                await websocket.send_json(state_changed_message(state))
            elif control.type == "client.resume":
                detail = await practice_service.resume_session(db, session_id, user_id)
                state = _practice_session_state_value(detail)
                runtime.state = state
                sync = runtime.resume_performance(now_ms=now_ms())
                await websocket.send_json(performance_lifecycle_message("resumed", sync))
                await websocket.send_json(state_changed_message(state))
            elif control.type == "client.finish":
                sync = runtime.performance_sync(now_ms=now_ms())
                runtime.finalize_performance_observations(now_ms=now_ms())
                outcomes = runtime.evaluate_expected_event_outcomes()
                detail = await practice_service.finish_session(
                    db,
                    session_id,
                    user_id,
                    completion_reason=PracticeSessionCompletionReason.STOPPED_BY_USER,
                )
                finished_state = _practice_session_state_value(detail)
                runtime.state = finished_state
                await websocket.send_json(performance_lifecycle_message("ended", sync))
                await websocket.send_json(
                    session_finished_message(
                        finished_state,
                        _practice_session_completion_outcome_value(detail),
                    )
                )
                await practice_service.build_summary_for_finished_session(
                    db,
                    session_id,
                    user_id,
                    performance_observations=runtime.performance_observations,
                    performance_outcomes=outcomes,
                )
                return (
                    "practice.websocket.finished",
                    "client_finished",
                    {"state": finished_state},
                )
            elif control.type == "client.heartbeat":
                sync = runtime.performance_sync(now_ms=now_ms())
                await websocket.send_json(performance_clock_sync_message(sync))
                terminal = await finish_scope_if_completed()
                if terminal is not None:
                    return terminal
            elif control.type == "client.midi_event":
                if runtime.state != "STREAMING":
                    continue
                try:
                    runtime.process_midi_event(
                        event_type=control.payload.event_type,
                        note_number=control.payload.note_number,
                        velocity=control.payload.velocity,
                        input_session_time_ms=control.payload.timestamp_ms,
                    )
                except RuntimeError:
                    await websocket.send_json(
                        session_error_message(public_code=ErrorCode.PRACTICE_ALIGNMENT_FAILED)
                    )
                    detail = await practice_service.fail_active_session_stream(
                        db,
                        session_id,
                        user_id,
                        reason="invalid performance midi input",
                    )
                    runtime.state = _practice_session_state_value(detail)
                    return (
                        "practice.websocket.failed",
                        "performance_midi_processing_failed",
                        {"public_code": ErrorCode.PRACTICE_ALIGNMENT_FAILED, "state": runtime.state},
                    )
                terminal = await finish_scope_if_completed()
                if terminal is not None:
                    return terminal
            elif control.type == "client.init":
                continue

        if message.get("bytes") is not None:
            if runtime.state != "STREAMING":
                continue
            try:
                runtime.process_audio_chunk(message["bytes"], now_ms=now_ms())
            except RuntimeError:
                await websocket.send_json(
                    session_error_message(public_code=ErrorCode.PRACTICE_ALIGNMENT_FAILED)
                )
                detail = await practice_service.fail_active_session_stream(
                    db,
                    session_id,
                    user_id,
                    reason="invalid performance audio input",
                )
                runtime.state = _practice_session_state_value(detail)
                return (
                    "practice.websocket.failed",
                    "performance_audio_processing_failed",
                        {"public_code": ErrorCode.PRACTICE_ALIGNMENT_FAILED, "state": runtime.state},
                    )
            sync = await send_clock_sync_if_due()
            terminal = await finish_scope_if_completed(sync)
            if terminal is not None:
                return terminal
            continue


def _practice_session_state_value(detail: PracticeSessionDetailRead) -> str:
    return detail.state.value


def _practice_session_completion_outcome_value(
    detail: PracticeSessionDetailRead,
) -> dict[str, object]:
    if detail.completion_outcome is None:
        raise RuntimeError("finished practice session is missing completion outcome")
    return detail.completion_outcome.model_dump(mode="json")
