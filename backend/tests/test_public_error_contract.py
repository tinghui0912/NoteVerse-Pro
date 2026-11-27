from __future__ import annotations


from app.core.generated.customer_browser_protocol import AUTH_COOKIE_NAME, CSRF_COOKIE_NAME

from collections.abc import Generator

from fastapi.testclient import TestClient

from app.platform.db.dependencies import get_db
from app.runtime.customer_api.main import app
from app.runtime.customer_api.resources import get_guest_preview_service
from app.shared.error_codes import CustomerErrorCode
from app.core.generated.control_plane_browser_protocol import (
    OPERATOR_AUTH_COOKIE_NAME,
    OPERATOR_CSRF_COOKIE_NAME,
)
from app.core.control_plane_errors import ControlPlaneErrorResponse
from app.shared.responses import ApiErrorResponse
from app.runtime.control_plane.context import get_context as get_control_context


def _assert_public_error_payload(payload: dict, expected_code: str) -> None:
    assert ApiErrorResponse.model_validate(payload).model_dump() == payload
    assert payload["code"] == expected_code


def test_ordinary_auth_errors_do_not_expose_internal_details(client: TestClient) -> None:
    response = client.get("/api/v1/me/profile", headers={"X-Request-ID": "public-auth-contract"})

    assert response.status_code == 401
    payload = response.json()
    _assert_public_error_payload(payload, CustomerErrorCode.TOKEN_INVALID_EXPIRED)
    assert payload["request_id"] == "public-auth-contract"


def test_ordinary_validation_errors_do_not_expose_validation_details(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        headers={"X-Request-ID": "public-validation-contract"},
    )

    assert response.status_code == 422
    payload = response.json()
    _assert_public_error_payload(payload, CustomerErrorCode.VALIDATION_ERROR)
    assert payload["request_id"] == "public-validation-contract"


def test_ordinary_csrf_errors_do_not_expose_security_details(client: TestClient) -> None:
    client.cookies.set(AUTH_COOKIE_NAME, "invalid-token")
    client.cookies.set(CSRF_COOKIE_NAME, "csrf-token")
    try:
        response = client.put(
            "/api/v1/me/profile",
            json={"display_name": "New Name"},
            headers={"X-Request-ID": "public-csrf-contract"},
        )
    finally:
        client.cookies.delete(AUTH_COOKIE_NAME)
        client.cookies.delete(CSRF_COOKIE_NAME)

    assert response.status_code == 403
    payload = response.json()
    _assert_public_error_payload(payload, CustomerErrorCode.CSRF_TOKEN_INVALID)
    assert payload["request_id"] == "public-csrf-contract"


def test_ordinary_unhandled_errors_do_not_expose_exception_details() -> None:
    class FailingPlaybackService:
        def audio(self, db, token: str):
            raise RuntimeError("redis worker failed while reading /internal/storage/path")

    def fake_get_db() -> Generator[object, None]:
        yield object()

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_guest_preview_service] = lambda: FailingPlaybackService()
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get(
                "/api/v1/guest-previews/preview-token/playback",
                headers={"X-Request-ID": "public-500-contract"},
            )
    finally:
        app.dependency_overrides.pop(get_guest_preview_service, None)
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 500
    payload = response.json()
    _assert_public_error_payload(payload, CustomerErrorCode.INTERNAL_ERROR)
    assert payload["request_id"] == "public-500-contract"
    assert "redis" not in str(payload).lower()
    assert "worker" not in str(payload).lower()
    assert "/internal/storage/path" not in str(payload)


def test_control_plane_errors_do_not_expose_internal_details_before_authorization(
    monkeypatch,
) -> None:
    monkeypatch.setenv("CONTROL_PLANE_COOKIE_SECURE", "false")
    monkeypatch.setenv("CONTROL_PLANE_COOKIE_SAMESITE", "lax")
    monkeypatch.setenv("CONTROL_PLANE_SESSION_EXPIRE_MINUTES", "30")
    monkeypatch.setenv("CONTROL_PLANE_CORS_ORIGINS", '["http://testserver"]')

    from app.runtime.control_plane.main import create_app

    get_control_context.cache_clear()

    try:
        with TestClient(create_app()) as control_client:
            control_client.cookies.set(OPERATOR_AUTH_COOKIE_NAME, "invalid-token")
            control_client.cookies.set(OPERATOR_CSRF_COOKIE_NAME, "csrf-token")
            response = control_client.post(
                "/api/v1/ops/async-operations/retry",
                json={"operation_kind": "render", "operation_id": "op-1"},
                headers={"X-Request-ID": "ops-csrf-contract"},
            )
    finally:
        get_control_context.cache_clear()

    assert response.status_code == 403
    payload = response.json()
    assert ControlPlaneErrorResponse.model_validate(payload).model_dump() == payload
    assert payload["code"] == CustomerErrorCode.CSRF_TOKEN_INVALID
    assert "internal_details" not in payload
    assert payload["request_id"] == "ops-csrf-contract"
