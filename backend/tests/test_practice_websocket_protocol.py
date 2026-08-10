from __future__ import annotations

import pytest

from app.processing.realtime.message_codec import parse_control_message, session_ready_message


def test_practice_websocket_messages_include_the_current_protocol_version() -> None:
    assert session_ready_message("session-1", "STREAMING") == {
        "protocol_version": 1,
        "type": "session.ready",
        "payload": {"session_id": "session-1", "state": "STREAMING"},
    }


def test_practice_websocket_control_frames_require_the_current_version() -> None:
    with pytest.raises(ValueError, match="protocol version"):
        parse_control_message('{"type": "client.heartbeat", "payload": {"t": 1}}')

    message = parse_control_message(
        '{"protocol_version": 1, "type": "client.heartbeat", "payload": {"t": 1}}'
    )
    assert message.type == "client.heartbeat"
