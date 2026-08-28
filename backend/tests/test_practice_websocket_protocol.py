from __future__ import annotations

from pydantic import ValidationError
import pytest

from app.processing.realtime.message_codec import (
    parse_control_message,
    session_finished_message,
    session_ready_message,
)
from app.processing.realtime.protocol import practice_server_message_adapter


def test_practice_websocket_messages_include_the_current_protocol_version() -> None:
    assert session_ready_message("session-1", "STREAMING") == {
        "protocol_version": 1,
        "type": "session.ready",
        "payload": {"session_id": "session-1", "state": "STREAMING"},
    }


def test_session_finished_message_includes_completion_outcome() -> None:
    message = session_finished_message(
        "FINISHED",
        {
            "kind": "FULL_PIECE_PERFORMANCE",
            "scope_kind": "FULL_PIECE",
            "summary_artifact_kind": "PERFORMANCE_SUMMARY",
            "playback_expected": True,
            "summary_available": True,
        },
    )

    assert message == {
        "protocol_version": 1,
        "type": "session.finished",
        "payload": {
            "state": "FINISHED",
            "completion_outcome": {
                "kind": "FULL_PIECE_PERFORMANCE",
                "scope_kind": "FULL_PIECE",
                "summary_artifact_kind": "PERFORMANCE_SUMMARY",
                "playback_expected": True,
                "summary_available": True,
            },
        },
    }


def test_practice_websocket_control_frames_require_the_current_version() -> None:
    with pytest.raises(ValueError, match="protocol version"):
        parse_control_message('{"type": "client.heartbeat", "payload": {"t": 1}}')

    message = parse_control_message(
        '{"protocol_version": 1, "type": "client.heartbeat", "payload": {"t": 1}}'
    )
    assert message.type == "client.heartbeat"


def test_practice_websocket_accepts_strict_midi_event_control_frames() -> None:
    message = parse_control_message(
        """
        {
          "protocol_version": 1,
          "type": "client.midi_event",
          "payload": {
            "event_type": "note_on",
            "note_number": 60,
            "velocity": 96,
            "timestamp_ms": 1234
          }
        }
        """
    )

    assert message.type == "client.midi_event"
    assert message.payload.note_number == 60

    with pytest.raises(ValidationError):
        parse_control_message(
            """
            {
              "protocol_version": 1,
              "type": "client.midi_event",
              "payload": {
                "event_type": "note_on",
                "note_number": 128,
                "velocity": 96,
                "timestamp_ms": 1234
              }
            }
            """
        )


def test_session_armed_message_requires_structured_input_health() -> None:
    message = practice_server_message_adapter.validate_python(
        {
            "protocol_version": 1,
            "type": "session.armed",
            "payload": {
                "session_id": "session-1",
                "input_health": {
                    "available": True,
                    "level": "good",
                    "noise": "elevated",
                    "confidence": 1.0,
                },
            },
        }
    )
    assert message.payload.input_health.noise == "elevated"

    with pytest.raises(ValidationError):
        practice_server_message_adapter.validate_python(
            {
                "protocol_version": 1,
                "type": "session.armed",
                "payload": {
                    "session_id": "session-1",
                    "environment_quality": "noisy",
                },
            }
        )


def test_alignment_update_message_requires_runtime_input_health() -> None:
    message = practice_server_message_adapter.validate_python(
        {
            "protocol_version": 1,
            "type": "alignment.update",
            "payload": {
                "beat_position": 3.0,
                "confidence": 0.9,
                "alignment_confidence": 0.9,
                "audio_confidence": 0.9,
                "continuity_confidence": 0.9,
                "visual_confidence": 0.9,
                "timestamp_ms": 10,
                "scope_completed": False,
            "completion_reason": None,
                "audio_active": True,
                "input_rms": 0.04,
                "input_peak": 0.1,
                "input_health": {
                    "available": True,
                    "level": "good",
                    "noise": "good",
                    "confidence": 1.0,
                },
                "match_state": "matched",
                "feature_confidence": 0.9,
                "beat_delta": None,
                "stream_state": "following",
                "frame_class": "tonal",
                "gate_reason": "accepted",
                "queue_decision": "queued_tonal",
                "tonal_signal": True,
                "onset_signal": True,
                "spectral_flatness": 0.1,
                "peak_prominence": 20,
                "spectral_flux": 0.3,
                "alignment_state": "matched",
                "continuity_state": "stable",
                "beat_velocity": None,
                "validation_confidence": 0.9,
                "input_weight": 1,
                "input_policy_confidence": 1,
                "decision": {
                    "action": "advance",
                    "reason": "stable_match",
                    "experience_state": "following",
                    "display_anchor": {"beat": 3.0, "render_note_ids": []},
                    "confidence_summary": {
                        "visual": 0.9,
                        "alignment": 0.9,
                        "audio": 0.9,
                        "continuity": 0.9,
                        "validation": 0.9,
                        "input_policy": 1,
                    },
                },
            },
        }
    )
    assert message.payload.input_health.level == "good"

    payload = message.model_dump(mode="json")
    del payload["payload"]["input_health"]
    with pytest.raises(ValidationError):
        practice_server_message_adapter.validate_python(payload)
