from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.modules.practice.dependencies import get_practice_service
from app.processing.realtime.session_runtime import practice_runtime_registry


class FakePracticeService:
    async def require_session_access(self, db, session_uuid: str, user_id: int):
        _ = (db, user_id)
        return SimpleNamespace(session_uuid=session_uuid)

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


def test_practice_websocket_flow_handles_control_messages_and_binary_audio(
    client: TestClient,
) -> None:
    practice_runtime_registry.clear()
    runtime = practice_runtime_registry.register(
        session_id="session-1",
        task_id="task-1",
        state="CREATED",
        timeline={
            "events": [
                {
                    "event_index": 0,
                    "measure_index": 0,
                    "measure_number": 1,
                    "beat_position": 0.0,
                    "duration_beats": 1.0,
                    "is_rest": False,
                    "staff": None,
                    "voice": None,
                    "pitches": ["C4"],
                }
            ],
            "total_events": 1,
            "total_measures": 1,
        },
    )

    app.dependency_overrides[get_practice_service] = lambda: FakePracticeService()

    async def fake_current_user(websocket, db):
        _ = (websocket, db)
        return SimpleNamespace(id=1, is_active=True)

    try:
        with patch("app.modules.practice.router.get_websocket_current_user", fake_current_user):
            with client.websocket_connect("/api/v1/practice/sessions/session-1/stream") as websocket:
                websocket.send_json({"type": "client.init", "payload": {"sample_rate": 16000}})
                ready = websocket.receive_json()
                assert ready == {
                    "type": "session.ready",
                    "payload": {
                        "session_id": "session-1",
                        "state": "STREAMING",
                    },
                }
                assert runtime.state == "STREAMING"

                websocket.send_bytes(b"\x01\x02\x03\x04")

                websocket.send_json({"type": "client.pause"})
                update = websocket.receive_json()
                assert update["type"] == "alignment.update"
                assert update["payload"]["event_index"] == 0
                assert update["payload"]["measure_index"] == 0
                paused = websocket.receive_json()
                assert paused == {
                    "type": "session.state_changed",
                    "payload": {"state": "PAUSED"},
                }
                assert len(runtime.audio_buffer) == 1
                assert runtime.state == "PAUSED"

                websocket.send_json({"type": "client.resume"})
                resumed = websocket.receive_json()
                assert resumed == {
                    "type": "session.state_changed",
                    "payload": {"state": "STREAMING"},
                }
                assert runtime.state == "STREAMING"

                websocket.send_json({"type": "client.finish"})
                finished = websocket.receive_json()
                assert finished == {
                    "type": "session.finished",
                    "payload": {"state": "FINISHED"},
                }
    finally:
        app.dependency_overrides.pop(get_practice_service, None)
        practice_runtime_registry.clear()


def test_practice_websocket_flow_surfaces_engine_failures(
    client: TestClient,
) -> None:
    practice_runtime_registry.clear()
    runtime = practice_runtime_registry.register(
        session_id="session-1",
        task_id="task-1",
        state="CREATED",
        timeline={
            "events": [
                {
                    "event_index": 0,
                    "measure_index": 0,
                    "measure_number": 1,
                    "beat_position": 0.0,
                    "duration_beats": 1.0,
                    "is_rest": False,
                    "staff": None,
                    "voice": None,
                    "pitches": ["C4"],
                }
            ],
            "total_events": 1,
            "total_measures": 1,
        },
    )
    runtime.engine = FailingEngine()
    app.dependency_overrides[get_practice_service] = lambda: FakePracticeService()

    async def fake_current_user(websocket, db):
        _ = (websocket, db)
        return SimpleNamespace(id=1, is_active=True)

    try:
        with patch("app.modules.practice.router.get_websocket_current_user", fake_current_user):
            with client.websocket_connect("/api/v1/practice/sessions/session-1/stream") as websocket:
                websocket.send_json({"type": "client.init"})
                websocket.receive_json()

                websocket.send_bytes(b"\x01\x02")
                error_message = websocket.receive_json()
                assert error_message == {
                    "type": "session.error",
                    "payload": {
                        "code": "practice_alignment_failed",
                        "message": "engine failure",
                    },
                }
    finally:
        app.dependency_overrides.pop(get_practice_service, None)
        practice_runtime_registry.clear()
