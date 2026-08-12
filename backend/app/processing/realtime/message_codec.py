from __future__ import annotations

import json
from typing import TYPE_CHECKING

from app.processing.realtime.protocol import (
    AlignmentUpdateMessage,
    AlignmentUpdatePayload,
    PracticeClientMessage,
    PracticeServerMessage,
    SessionArmedMessage,
    SessionArmedPayload,
    SessionErrorMessage,
    SessionErrorPayload,
    SessionFinishedMessage,
    SessionConnectingMessage,
    SessionConnectingPayload,
    SessionReadyMessage,
    SessionReadyPayload,
    SessionStateChangedMessage,
    SessionStatePayload,
    practice_client_message_adapter,
)

if TYPE_CHECKING:
    from app.processing.engines.practice_alignment.contracts import AlignmentUpdate


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


def session_armed_message(session_id: str, environment_quality: str) -> dict[str, object]:
    return _message_payload(
        SessionArmedMessage(
            payload=SessionArmedPayload(
                session_id=session_id,
                environment_quality=environment_quality,
            )
        )
    )


def state_changed_message(state: str) -> dict[str, object]:
    return _message_payload(SessionStateChangedMessage(payload=SessionStatePayload(state=state)))


def session_finished_message(state: str) -> dict[str, object]:
    return _message_payload(SessionFinishedMessage(payload=SessionStatePayload(state=state)))


def session_error_message(public_code: str, public_message: str | None = None) -> dict[str, object]:
    return _message_payload(
        SessionErrorMessage(
            payload=SessionErrorPayload(
                public_code=public_code,
                public_message=public_message or public_code,
            )
        )
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
                score_completed=update["score_completed"],
                audio_active=update.get("audio_active", True),
                input_rms=update.get("input_rms", 0.0),
                input_peak=update.get("input_peak", 0.0),
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
            )
        )
    )
