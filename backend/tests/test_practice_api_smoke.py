from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.modules.practice.dependencies import get_practice_service
from app.practice_main import app
from app.shared.constants import ErrorCode


def _request(
    client: TestClient,
    method: str,
    path: str,
    payload: dict | None = None,
):
    kwargs = {}
    if payload is not None:
        kwargs["json"] = payload
    return getattr(client, method)(path, **kwargs)


class FakePracticeService:
    async def get_session_detail(
        self,
        db,
        session_uuid: str,
        user_id: int,
    ) -> dict[str, object]:
        if session_uuid == "missing-session":
            raise ResourceNotFoundException(
                resource_type="practice_session",
                resource_id=session_uuid,
                code=ErrorCode.PRACTICE_SESSION_NOT_FOUND,
            )
        if session_uuid == "forbidden-session":
            raise UnauthorizedException(
                code=ErrorCode.NO_PRACTICE_ACCESS,
                details={"session_id": session_uuid},
            )
        return {
            "session_id": session_uuid,
            "score_id": "score-1",
            "revision_id": "revision-1",
            "access_origin": "OWNER",
            "state": "FINISHED",
            "sample_rate": 16000,
            "channels": 1,
            "frame_format": "pcm_s16le",
            "started_at": None,
            "finished_at": None,
            "last_beat_position": 15.5,
            "last_confidence": 0.91,
            "summary_status": "READY",
        }

    async def get_summary(
        self,
        db,
        session_uuid: str,
        user_id: int,
    ) -> dict[str, object]:
        return {
            "session_id": session_uuid,
            "summary_status": "READY",
            "summary_payload": {
                "summary": "Practice session completed with strong alignment confidence.",
                "metrics": {
                    "state": "FINISHED",
                    "confidence_label": "Strong",
                },
                "recommendations": ["Keep the same pacing and focus on phrasing while timing remains stable."],
            },
        }

    async def get_practice_ready_score_content(
        self,
        db,
        score_uuid: str,
        user_id: int,
        revision_uuid: str,
    ) -> dict[str, object]:
        return {
            "score_id": score_uuid,
            "revision_id": revision_uuid,
            "content": '<score-partwise><part><measure><note id="nv-p1-m1-note1" /></measure></part></score-partwise>',
            "mime_type": "application/vnd.recordare.musicxml+xml",
        }


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def test_practice_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("post", "/api/v1/practice/sessions", {"score_id": "score-1"}),
        ("get", "/api/v1/practice/sessions/session-1", None),
        ("post", "/api/v1/practice/sessions/session-1/pause", None),
        ("post", "/api/v1/practice/sessions/session-1/resume", None),
        ("post", "/api/v1/practice/sessions/session-1/finish", None),
        ("get", "/api/v1/practice/sessions/session-1/summary", None),
        ("get", "/api/v1/practice/scores/score-1/revisions/revision-1/content", None),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_get_practice_session_returns_not_found_for_missing_session(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, is_active=True)
    app.dependency_overrides[get_practice_service] = lambda: FakePracticeService()

    response = client.get("/api/v1/practice/sessions/missing-session")

    assert response.status_code == 404
    assert response.json()["public_code"] == ErrorCode.PRACTICE_SESSION_NOT_FOUND


def test_get_practice_session_rejects_unauthorized_access(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, is_active=True)
    app.dependency_overrides[get_practice_service] = lambda: FakePracticeService()

    response = client.get("/api/v1/practice/sessions/forbidden-session")

    assert response.status_code == 403
    assert response.json()["public_code"] == ErrorCode.NO_PRACTICE_ACCESS


def test_get_practice_session_summary_returns_structured_payload(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, is_active=True)
    app.dependency_overrides[get_practice_service] = lambda: FakePracticeService()

    response = client.get("/api/v1/practice/sessions/session-1/summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["summary_status"] == "READY"
    assert payload["data"]["summary_payload"]["metrics"]["confidence_label"] == "Strong"


def test_get_practice_ready_score_content_returns_prepared_musicxml(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, is_active=True)
    app.dependency_overrides[get_practice_service] = lambda: FakePracticeService()

    response = client.get("/api/v1/practice/scores/score-1/revisions/revision-1/content")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["score_id"] == "score-1"
    assert payload["data"]["revision_id"] == "revision-1"
    assert 'id="nv-p1-m1-note1"' in payload["data"]["content"]


def test_practice_openapi_keeps_session_response_contracts_explicit() -> None:
    schema = app.openapi()
    components = schema["components"]["schemas"]
    paths = schema["paths"]

    assert paths["/api/v1/practice/sessions"]["post"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/APIResponse_PracticeSessionStartRead_"}
    assert paths["/api/v1/practice/sessions/{session_id}"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/APIResponse_PracticeSessionDetailRead_"
    }

    expected_required_fields = {
        "PracticeSessionStartRead": {"session_id", "state", "ws_url"},
        "PracticeSessionDetailRead": {
            "session_id",
            "score_id",
            "revision_id",
            "access_origin",
            "state",
            "progression_mode",
            "realtime_guidance",
            "evaluation_profile",
            "input_source",
            "sample_rate",
            "channels",
            "frame_format",
            "started_at",
            "finished_at",
            "last_beat_position",
            "last_confidence",
            "summary_status",
            "completion_outcome",
        },
        "PracticeSessionResultSummaryRead": {"session_id", "summary_status", "summary_payload"},
    }
    for schema_name, fields in expected_required_fields.items():
        assert fields.issubset(components[schema_name]["required"])
