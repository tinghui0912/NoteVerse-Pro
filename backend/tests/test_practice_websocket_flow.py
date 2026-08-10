from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.modules.practice.dependencies import get_practice_service
from app.practice_main import app
from app.processing.realtime.session_runtime import practice_runtime_registry


class FakePracticeService:
    runtime_registry = practice_runtime_registry

    async def require_session_access(self, db, session_uuid: str, user_id: int):
        _ = (db, user_id)
        return SimpleNamespace(session_uuid=session_uuid)

    async def prepare_stream_runtime(self, db, session_uuid: str, user_id: int):
        _ = (db, user_id)
        return self.runtime_registry.get(session_uuid)

    async def start_session_stream(self, db, session_uuid: str, user_id: int):
        _ = (db, user_id)
        return {"state": "STREAMING"}

    async def pause_session(self, db, session_uuid: str, user_id: int):
        _ = (db, session_uuid, user_id)
        return {"state": "PAUSED"}

    async def resume_session(self, db, session_uuid: str, user_id: int):
        _ = (db, session_uuid, user_id)
        return {"state": "STREAMING"}

    async def finish_session(self, db, session_uuid: str, user_id: int):
        _ = (db, user_id)
        practice_runtime_registry.release(session_uuid)
        return {"state": "FINISHED"}

    async def persist_alignment(self, db, session_uuid: str, alignment):
        _ = (db, session_uuid, alignment)


class FailingEngine:
    def ingest_audio(self, chunk: bytes):
        _ = chunk
        raise RuntimeError("engine failure")

    @property
    def is_ready_for_performance(self) -> bool:
        return False

    def close(self) -> None:
        pass


class StreamingEngine:
    def ingest_audio(self, chunk: bytes):
        _ = chunk
        return {
            "beat_position": 0.0,
            "confidence": 0.95,
            "alignment_confidence": 0.95,
            "audio_confidence": 0.95,
            "continuity_confidence": 0.95,
            "visual_confidence": 0.95,
            "timestamp_ms": 20,
            "score_completed": False,
            "audio_active": True,
            "input_rms": 0.04,
            "input_peak": 0.1,
            "match_state": "matched",
        }

    @property
    def is_ready_for_performance(self) -> bool:
        return False

    def close(self) -> None:
        pass


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def test_practice_websocket_flow_handles_control_messages_and_binary_audio(
    client: TestClient,
) -> None:
    practice_runtime_registry.clear()
    with patch(
        "app.processing.realtime.session_runtime.build_alignment_engine",
        return_value=StreamingEngine(),
    ):
        runtime = practice_runtime_registry.register(
            session_id="session-1",
            task_id="task-1",
            state="CREATED",
            score_file_path="score.xml",
        )

    app.dependency_overrides[get_practice_service] = lambda: FakePracticeService()

    async def fake_current_user(websocket, db):
        _ = (websocket, db)
        return SimpleNamespace(id=1, is_active=True)

    try:
        with patch("app.modules.practice.router.get_websocket_current_user", fake_current_user):
            with client.websocket_connect("/api/v1/practice/sessions/session-1/stream") as websocket:
                websocket.send_json(
                    {
                        "protocol_version": 1,
                        "type": "client.init",
                        "payload": {"sample_rate": 16000, "channels": 1, "frame_samples": 640},
                    }
                )
                connecting = websocket.receive_json()
                assert connecting == {
                    "protocol_version": 1,
                    "type": "session.connecting",
                    "payload": {"session_id": "session-1"},
                }
                ready = websocket.receive_json()
                assert ready == {
                    "protocol_version": 1,
                    "type": "session.ready",
                    "payload": {
                        "session_id": "session-1",
                        "state": "STREAMING",
                    },
                }
                assert runtime.state == "STREAMING"

                websocket.send_bytes(b"\x01\x02\x03\x04")

                websocket.send_json(
                    {"protocol_version": 1, "type": "client.pause", "payload": {"t": 1}}
                )
                update = websocket.receive_json()
                assert update["type"] == "alignment.update"
                assert update["payload"]["beat_position"] == 0.0
                assert update["payload"]["confidence"] == 0.95
                paused = websocket.receive_json()
                assert paused == {
                    "protocol_version": 1,
                    "type": "session.state_changed",
                    "payload": {"state": "PAUSED"},
                }
                assert len(runtime.audio_buffer) == 1
                assert runtime.state == "PAUSED"

                websocket.send_bytes(b"\x05\x06\x07\x08")

                websocket.send_json(
                    {"protocol_version": 1, "type": "client.resume", "payload": {"t": 2}}
                )
                resumed = websocket.receive_json()
                assert resumed == {
                    "protocol_version": 1,
                    "type": "session.state_changed",
                    "payload": {"state": "STREAMING"},
                }
                assert runtime.state == "STREAMING"
                assert len(runtime.audio_buffer) == 1

                websocket.send_bytes(b"\x09\x0a\x0b\x0c")
                resumed_update = websocket.receive_json()
                assert resumed_update["type"] == "alignment.update"
                assert len(runtime.audio_buffer) == 2

                websocket.send_json(
                    {"protocol_version": 1, "type": "client.finish", "payload": {"t": 3}}
                )
                finished = websocket.receive_json()
                assert finished == {
                    "protocol_version": 1,
                    "type": "session.finished",
                    "payload": {"state": "FINISHED"},
                }
    finally:
        app.dependency_overrides.pop(get_practice_service, None)
        practice_runtime_registry.clear()


def test_practice_websocket_flow_returns_stable_alignment_error(
    client: TestClient,
) -> None:
    practice_runtime_registry.clear()
    with patch(
        "app.processing.realtime.session_runtime.build_alignment_engine",
        return_value=FailingEngine(),
    ):
        practice_runtime_registry.register(
            session_id="session-1",
            task_id="task-1",
            state="CREATED",
            score_file_path="score.xml",
        )
    app.dependency_overrides[get_practice_service] = lambda: FakePracticeService()

    async def fake_current_user(websocket, db):
        _ = (websocket, db)
        return SimpleNamespace(id=1, is_active=True)

    try:
        with patch("app.modules.practice.router.get_websocket_current_user", fake_current_user):
            with client.websocket_connect("/api/v1/practice/sessions/session-1/stream") as websocket:
                websocket.send_json(
                    {
                        "protocol_version": 1,
                        "type": "client.init",
                        "payload": {"sample_rate": 16000, "channels": 1, "frame_samples": 640},
                    }
                )
                connecting = websocket.receive_json()
                assert connecting["type"] == "session.connecting"
                websocket.receive_json()

                websocket.send_bytes(b"\x01\x02")
                error_message = websocket.receive_json()
                assert error_message == {
                    "protocol_version": 1,
                    "type": "session.error",
                    "payload": {
                        "public_code": "practice_alignment_failed",
                        "public_message": "practice_alignment_failed",
                    },
                }
    finally:
        app.dependency_overrides.pop(get_practice_service, None)
        practice_runtime_registry.clear()
