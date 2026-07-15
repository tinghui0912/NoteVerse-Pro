from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi.testclient import TestClient

from app.api.deps import get_db
from app.core.config import settings
from app.main import app
from app.modules.playback.router import get_playback_service
from app.shared.constants import ErrorCode


def _assert_public_error_payload(payload: dict, expected_code: str) -> None:
    assert payload["success"] is False
    assert payload["public_code"] == expected_code
    assert payload["public_message"] == expected_code
    assert "internal_details" not in payload
    assert "details" not in payload
    assert "error" not in payload
    assert "error_type" not in payload
    assert "last_error" not in payload


def test_ordinary_auth_errors_do_not_expose_internal_details(client: TestClient) -> None:
    response = client.get("/api/v1/me/profile", headers={"X-Request-ID": "public-auth-contract"})

    assert response.status_code == 401
    payload = response.json()
    _assert_public_error_payload(payload, ErrorCode.TOKEN_INVALID_EXPIRED)
    assert payload["request_id"] == "public-auth-contract"


def test_ordinary_validation_errors_do_not_expose_validation_details(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        headers={"X-Request-ID": "public-validation-contract"},
    )

    assert response.status_code == 422
    payload = response.json()
    _assert_public_error_payload(payload, ErrorCode.VALIDATION_ERROR)
    assert payload["request_id"] == "public-validation-contract"


def test_ordinary_csrf_errors_do_not_expose_security_details(client: TestClient) -> None:
    client.cookies.set(settings.AUTH_COOKIE_NAME, "invalid-token")
    client.cookies.set(settings.CSRF_COOKIE_NAME, "csrf-token")
    try:
        response = client.put(
            "/api/v1/me/profile",
            json={"display_name": "New Name"},
            headers={"X-Request-ID": "public-csrf-contract"},
        )
    finally:
        client.cookies.delete(settings.AUTH_COOKIE_NAME)
        client.cookies.delete(settings.CSRF_COOKIE_NAME)

    assert response.status_code == 403
    payload = response.json()
    _assert_public_error_payload(payload, ErrorCode.CSRF_TOKEN_INVALID)
    assert payload["request_id"] == "public-csrf-contract"


def test_ordinary_unhandled_errors_do_not_expose_exception_details() -> None:
    class FailingPlaybackService:
        async def grant_delivery(self, db, token: str, user_id: int | None):
            raise RuntimeError("redis worker failed while reading /internal/storage/path")

    async def fake_get_db() -> AsyncGenerator[object, None]:
        yield object()

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_playback_service] = lambda: FailingPlaybackService()
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get(
                "/api/v1/score-grants/share-token/playback",
                headers={"X-Request-ID": "public-500-contract"},
            )
    finally:
        app.dependency_overrides.pop(get_playback_service, None)
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 500
    payload = response.json()
    _assert_public_error_payload(payload, ErrorCode.INTERNAL_ERROR)
    assert payload["request_id"] == "public-500-contract"
    assert "redis" not in str(payload).lower()
    assert "worker" not in str(payload).lower()
    assert "/internal/storage/path" not in str(payload)


def test_ops_errors_can_include_internal_details(client: TestClient) -> None:
    client.cookies.set(settings.AUTH_COOKIE_NAME, "invalid-token")
    client.cookies.set(settings.CSRF_COOKIE_NAME, "csrf-token")
    try:
        response = client.post(
            "/api/v1/ops/async-operations/retry",
            json={"operation_kind": "render", "operation_id": "op-1"},
            headers={"X-Request-ID": "ops-csrf-contract"},
        )
    finally:
        client.cookies.delete(settings.AUTH_COOKIE_NAME)
        client.cookies.delete(settings.CSRF_COOKIE_NAME)

    assert response.status_code == 403
    payload = response.json()
    assert payload["success"] is False
    assert payload["public_code"] == ErrorCode.CSRF_TOKEN_INVALID
    assert payload["internal_details"] == {"reason": "csrf_token_mismatch"}
    assert payload["request_id"] == "ops-csrf-contract"
