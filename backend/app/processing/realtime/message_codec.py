from __future__ import annotations

from typing import TypedDict
import json

from app.processing.engines.matchmaker_live import AlignmentUpdate


class RuntimeMessage(TypedDict):
    type: str
    payload: dict[str, object]


def parse_control_message(raw_message: str) -> RuntimeMessage:
    payload = json.loads(raw_message)
    return {
        "type": str(payload.get("type", "")),
        "payload": dict(payload.get("payload") or {}),
    }


def session_ready_message(session_id: str, state: str) -> RuntimeMessage:
    return {
        "type": "session.ready",
        "payload": {
            "session_id": session_id,
            "state": state,
        },
    }


def session_armed_message(session_id: str) -> RuntimeMessage:
    return {
        "type": "session.armed",
        "payload": {
            "session_id": session_id,
        },
    }


def state_changed_message(state: str) -> RuntimeMessage:
    return {
        "type": "session.state_changed",
        "payload": {
            "state": state,
        },
    }


def session_finished_message(state: str) -> RuntimeMessage:
    return {
        "type": "session.finished",
        "payload": {
            "state": state,
        },
    }


def session_error_message(code: str, message: str) -> RuntimeMessage:
    return {
        "type": "session.error",
        "payload": {
            "code": code,
            "message": message,
        },
    }


def alignment_update_message(update: AlignmentUpdate) -> RuntimeMessage:
    return {
        "type": "alignment.update",
        "payload": {
            "beat_position": update["beat_position"],
            "confidence": update["confidence"],
            "alignment_confidence": update["alignment_confidence"],
            "audio_confidence": update["audio_confidence"],
            "continuity_confidence": update["continuity_confidence"],
            "visual_confidence": update["visual_confidence"],
            "timestamp_ms": update["timestamp_ms"],
            "score_completed": update["score_completed"],
            "audio_active": update.get("audio_active", True),
            "input_rms": update.get("input_rms", 0.0),
            "input_peak": update.get("input_peak", 0.0),
            "match_state": update.get("match_state", "matched"),
            "feature_confidence": update.get("feature_confidence", 1.0),
            "beat_delta": update.get("beat_delta"),
            "stream_state": update.get("stream_state", "unknown"),
            "frame_class": update.get("frame_class", "unknown"),
            "gate_reason": update.get("gate_reason", "unknown"),
            "queue_decision": update.get("queue_decision", "unknown"),
            "tonal_signal": update.get("tonal_signal", False),
            "onset_signal": update.get("onset_signal", False),
            "spectral_flatness": update.get("spectral_flatness", 1.0),
            "peak_prominence": update.get("peak_prominence", 0.0),
            "spectral_flux": update.get("spectral_flux", 0.0),
            "alignment_state": update.get("alignment_state", "matched"),
            "continuity_state": update.get("continuity_state", "stable"),
            "beat_velocity": update.get("beat_velocity"),
            "validation_confidence": update.get("validation_confidence", 1.0),
            "input_weight": update.get("input_weight", 0.0),
            "input_policy_confidence": update.get("input_policy_confidence", 1.0),
        },
    }
