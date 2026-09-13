from __future__ import annotations

import json
from typing import TYPE_CHECKING

from app.processing.realtime.protocol import (
    AlignmentUpdateMessage,
    AlignmentUpdatePayload,
    InputHealthPayload,
    PracticeClientMessage,
    PracticeServerMessage,
    PerformanceClockSyncMessage,
    PerformanceClockSyncPayload,
    PerformanceEndedMessage,
    PerformancePausedMessage,
    PerformanceResumedMessage,
    PerformanceStartedMessage,
    PerformanceTimelineMessage,
    PerformanceTimelineProjectionPayload,
    PerformanceTimelineProjectionSegmentPayload,
    SessionArmedMessage,
    SessionArmedPayload,
    SessionErrorMessage,
    SessionErrorPayload,
    SessionFinishedMessage,
    SessionFinishedPayload,
    SessionConnectingMessage,
    SessionConnectingPayload,
    SessionReadyMessage,
    SessionReadyPayload,
    SessionStateChangedMessage,
    SessionStatePayload,
    practice_client_message_adapter,
)

if TYPE_CHECKING:
    from app.processing.engines.practice_alignment.contracts import AlignmentUpdate, InputHealth
    from app.processing.performance.runtime import PerformanceClockSync
    from app.processing.performance.timeline import PerformanceTimelineProjection


def parse_control_message(raw_message: str) -> PracticeClientMessage:
    """Decode one strictly versioned browser control frame."""

    payload = json.loads(raw_message)
    if not isinstance(payload, dict) or payload.get("protocol_version") != 1:
        raise ValueError("unsupported Practice WebSocket protocol version")
    return practice_client_message_adapter.validate_python(payload)


def _message_payload(message: PracticeServerMessage) -> dict[str, object]:
    return message.model_dump(mode="json")


def session_ready_message(session_id: str, state: str) -> dict[str, object]:
    return _message_payload(
        SessionReadyMessage(payload=SessionReadyPayload(session_id=session_id, state=state))
    )


def session_connecting_message(session_id: str) -> dict[str, object]:
    return _message_payload(SessionConnectingMessage(payload=SessionConnectingPayload(session_id=session_id)))


def session_armed_message(session_id: str, input_health: "InputHealth") -> dict[str, object]:
    return _message_payload(
        SessionArmedMessage(
            payload=SessionArmedPayload(
                session_id=session_id,
                input_health=InputHealthPayload(**input_health),
            )
        )
    )


def state_changed_message(state: str) -> dict[str, object]:
    return _message_payload(SessionStateChangedMessage(payload=SessionStatePayload(state=state)))


def session_finished_message(
    state: str,
    completion_outcome: dict[str, object],
) -> dict[str, object]:
    return _message_payload(
        SessionFinishedMessage(
            payload=SessionFinishedPayload(
                state=state,
                completion_outcome=completion_outcome,
            )
        )
    )


def session_error_message(public_code: str, public_message: str | None = None) -> dict[str, object]:
    return _message_payload(
        SessionErrorMessage(
            payload=SessionErrorPayload(
                public_code=public_code,
                public_message=public_message or public_code,
            )
        )
    )


def performance_clock_sync_message(sync: "PerformanceClockSync") -> dict[str, object]:
    return _message_payload(
        PerformanceClockSyncMessage(payload=_performance_clock_sync_payload(sync))
    )


def performance_timeline_message(
    projection: "PerformanceTimelineProjection",
) -> dict[str, object]:
    return _message_payload(
        PerformanceTimelineMessage(
            payload=PerformanceTimelineProjectionPayload(
                scope_start_beat=projection.scope_start_beat,
                scope_terminal_beat=projection.scope_terminal_beat,
                segments=[
                    PerformanceTimelineProjectionSegmentPayload(
                        start_performance_time_ms=segment.start_performance_time_ms,
                        end_performance_time_ms=segment.end_performance_time_ms,
                        start_beat=segment.start_beat,
                        end_beat=segment.end_beat,
                    )
                    for segment in projection.segments
                ],
            )
        )
    )


def performance_lifecycle_message(
    event: str,
    sync: "PerformanceClockSync",
) -> dict[str, object]:
    payload = _performance_clock_sync_payload(sync)
    if event == "started":
        return _message_payload(PerformanceStartedMessage(payload=payload))
    if event == "paused":
        return _message_payload(PerformancePausedMessage(payload=payload))
    if event == "resumed":
        return _message_payload(PerformanceResumedMessage(payload=payload))
    if event == "ended":
        return _message_payload(PerformanceEndedMessage(payload=payload))
    raise ValueError(f"Unsupported performance lifecycle event: {event}")


def _performance_clock_sync_payload(sync: "PerformanceClockSync") -> PerformanceClockSyncPayload:
    return PerformanceClockSyncPayload(
        state=sync.state.value,
        musical_beat=sync.musical_beat,
        performance_time_ms=sync.performance_time_ms,
        count_in_remaining_ms=sync.count_in_remaining_ms,
        count_in_remaining_pulses=sync.count_in_remaining_pulses,
        scope_completed=sync.scope_completed,
        scope_start_group_id=sync.scope_start_group_id,
        scope_end_group_id=sync.scope_end_group_id,
        scope_start_beat=sync.scope_start_beat,
        scope_terminal_beat=sync.scope_terminal_beat,
        nominal_scope_duration_ms=sync.nominal_scope_duration_ms,
        speed_ratio=sync.speed_ratio,
    )


def alignment_update_message(update: AlignmentUpdate) -> dict[str, object]:
    return _message_payload(
        AlignmentUpdateMessage(
            payload=AlignmentUpdatePayload(
                beat_position=update["beat_position"],
                confidence=update["confidence"],
                alignment_confidence=update["alignment_confidence"],
                audio_confidence=update["audio_confidence"],
                continuity_confidence=update["continuity_confidence"],
                visual_confidence=update["visual_confidence"],
                timestamp_ms=update["timestamp_ms"],
                scope_completed=update["scope_completed"],
                completion_reason=update["completion_reason"],
                audio_active=update.get("audio_active", True),
                input_rms=update.get("input_rms", 0.0),
                input_peak=update.get("input_peak", 0.0),
                input_health=InputHealthPayload(**update["input_health"]),
                match_state=update.get("match_state", "matched"),
                feature_confidence=update.get("feature_confidence", 1.0),
                beat_delta=update.get("beat_delta"),
                stream_state=update.get("stream_state", "unknown"),
                frame_class=update.get("frame_class", "unknown"),
                gate_reason=update.get("gate_reason", "unknown"),
                queue_decision=update.get("queue_decision", "unknown"),
                tonal_signal=update.get("tonal_signal", False),
                onset_signal=update.get("onset_signal", False),
                spectral_flatness=update.get("spectral_flatness", 1.0),
                peak_prominence=update.get("peak_prominence", 0.0),
                spectral_flux=update.get("spectral_flux", 0.0),
                alignment_state=update.get("alignment_state", "matched"),
                continuity_state=update.get("continuity_state", "stable"),
                beat_velocity=update.get("beat_velocity"),
                validation_confidence=update.get("validation_confidence", 1.0),
                input_weight=update.get("input_weight", 0.0),
                input_policy_confidence=update.get("input_policy_confidence", 1.0),
                decision=update["decision"],
            )
        )
    )
