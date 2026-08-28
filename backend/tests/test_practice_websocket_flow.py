from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.db.models.practice import PracticeSessionSummaryStatus, PracticeSessionState
from app.db.models.score_access import AccessOrigin
from app.modules.practice.dependencies import get_practice_service
from app.modules.practice.schemas import PracticeSessionDetailRead
from app.practice_main import app
from app.processing.realtime.session_runtime import practice_runtime_registry

GOOD_INPUT_HEALTH = {
    "available": True,
    "level": "good",
    "noise": "good",
    "confidence": 1.0,
}


def _session_detail(state: PracticeSessionState) -> PracticeSessionDetailRead:
    completion_outcome = (
        {
            "kind": "FULL_PIECE_PERFORMANCE",
            "scope_kind": "FULL_PIECE",
            "summary_artifact_kind": "PERFORMANCE_SUMMARY",
            "playback_expected": True,
            "summary_available": True,
        }
        if state == PracticeSessionState.FINISHED
        else None
    )
    return PracticeSessionDetailRead(
        session_id="session-1",
        score_id="score-1",
        revision_id="revision-1",
        access_origin=AccessOrigin.OWNER,
        state=state,
        progression_mode="CONTINUOUS",
        realtime_guidance="STATUS_ONLY",
        evaluation_profile="PERFORMANCE",
        input_source="MICROPHONE",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        started_at=None,
        finished_at=None,
        last_beat_position=None,
        last_confidence=None,
        summary_status=PracticeSessionSummaryStatus.NOT_REQUESTED,
        completion_outcome=completion_outcome,
    )


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
        return _session_detail(PracticeSessionState.STREAMING)

    async def pause_session(self, db, session_uuid: str, user_id: int):
        _ = (db, session_uuid, user_id)
        return _session_detail(PracticeSessionState.PAUSED)

    async def resume_session(self, db, session_uuid: str, user_id: int):
        _ = (db, session_uuid, user_id)
        return _session_detail(PracticeSessionState.STREAMING)

    async def finish_session(self, db, session_uuid: str, user_id: int):
        _ = (db, user_id)
        practice_runtime_registry.release(session_uuid)
        return _session_detail(PracticeSessionState.FINISHED)

    async def persist_alignment(self, db, session_uuid: str, alignment):
        _ = (db, session_uuid, alignment)

    async def persist_practice_attempt(self, db, session_uuid: str, resolved_attempt):
        _ = (db, session_uuid, resolved_attempt)

    async def finalize_pending_practice_attempts(self, db, session_uuid: str, *, reason):
        _ = (db, session_uuid, reason)


class FailingEngine:
    def ingest_audio(self, chunk: bytes):
        _ = chunk
        raise RuntimeError("engine failure")

    def reset_input_buffer(self) -> None:
        pass

    def drain_resolved_practice_attempts(self):
        return []

    def finalize_pending_practice_attempt(self, *, reason):
        _ = reason
        return []

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
            "scope_completed": False,
            "completion_reason": None,
            "audio_active": True,
            "input_rms": 0.04,
            "input_peak": 0.1,
            "input_health": GOOD_INPUT_HEALTH,
            "match_state": "matched",
            "decision": {
                "action": "advance",
                "reason": "stable_match",
                "experience_state": "following",
                "display_anchor": {"beat": 0.0, "render_note_ids": []},
                "confidence_summary": {
                    "visual": 0.95,
                    "alignment": 0.95,
                    "audio": 0.95,
                    "continuity": 0.95,
                    "validation": 1.0,
                    "input_policy": 1.0,
                },
            },
        }

    def reset_input_buffer(self) -> None:
        pass

    def drain_resolved_practice_attempts(self):
        return []

    def finalize_pending_practice_attempt(self, *, reason):
        _ = reason
        return []

    @property
    def is_ready_for_performance(self) -> bool:
        return False

    @property
    def input_health(self):
        return GOOD_INPUT_HEALTH

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
                        "payload": {
                            "sample_rate": 16000,
                            "channels": 1,
                            "frame_samples": 640,
                            "progression_mode": "CONTINUOUS",
                            "realtime_guidance": "STATUS_ONLY",
                            "evaluation_profile": "PERFORMANCE",
                            "input_source": "MICROPHONE",
                        },
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
                        "payload": {
                            "sample_rate": 16000,
                            "channels": 1,
                            "frame_samples": 640,
                            "progression_mode": "CONTINUOUS",
                            "realtime_guidance": "STATUS_ONLY",
                            "evaluation_profile": "PERFORMANCE",
                            "input_source": "MICROPHONE",
                        },
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
