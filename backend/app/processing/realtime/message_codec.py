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


def session_warning_message(code: str, message: str) -> RuntimeMessage:
    return {
        "type": "session.warning",
        "payload": {
            "code": code,
            "message": message,
        },
    }


def alignment_update_message(update: AlignmentUpdate) -> RuntimeMessage:
    return {
        "type": "alignment.update",
        "payload": {
            "event_index": update["event_index"],
            "measure_index": update["measure_index"],
            "measure_number": update["measure_number"],
            "beat_position": update["beat_position"],
            "confidence": update["confidence"],
            "timestamp_ms": update["timestamp_ms"],
            "score_completed": update["score_completed"],
        },
    }
