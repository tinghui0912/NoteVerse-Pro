"""CSRF admission follows actual matched operations and explicit application policy."""

from app.runtime.customer_api.context import get_context

from tests.support.http_errors import CUSTOMER_HTTP_ERRORS

import ast
import inspect
from dataclasses import fields
from datetime import UTC, datetime
from textwrap import dedent
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import APIRouter
from app.core.http_application import HttpApplication
from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.api.customer_security import (
    CUSTOMER_CSRF_EXEMPT_OPERATION_IDS,
    customer_csrf_exempt_operation,
)
from app.platform.db.dependencies import get_db
from app.core.generated.customer_browser_protocol import (
    AUTH_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    CUSTOMER_API_PREFIX,
)
from app.core.middleware import CookieCsrfSettings, CsrfProtectionMiddleware
from app.runtime.customer_api.main import _csrf_settings, create_app
from app.modules.auth.service import LoginResult
from app.modules.account.schemas import ProfileUserRead
from app.runtime.customer_api.auth_services import (
    get_auth_service,
    get_email_change_service,
    get_password_reset_service,
    get_session_service,
)
from app.runtime.customer_api.resources import get_email_verification_service


@pytest.fixture
def customer():
    app = create_app()
    service = SimpleNamespace(
        login=Mock(
            return_value=LoginResult(
                "session",
                ProfileUserRead(
                    id=1,
                    email="member@example.com",
                    display_name="Member",
                    avatar_url=None,
                    is_active=True,
                    created_at=datetime(2026, 1, 1, tzinfo=UTC),
                ),
            )
        ),
        revoke_session=Mock(),
        register=Mock(),
        verify_email=Mock(return_value={"email": "member@example.com"}),
        confirm_email_change=Mock(return_value=SimpleNamespace(email="new@example.com")),
        request_password_reset=Mock(),
        reset_password=Mock(),
    )

    def database():
        yield object()

    app.dependency_overrides[get_db] = database
    for dependency in (
        get_auth_service,
        get_session_service,
        get_email_verification_service,
        get_email_change_service,
        get_password_reset_service,
    ):
        app.dependency_overrides[dependency] = lambda: service
    routes = {
        route.operation_id: route
        for route in iter_route_contexts(app.routes)
        if getattr(route, "operation_id", None)
    }
    with TestClient(app, base_url="https://testserver") as client:
        yield client, service, routes


PUBLIC_COMMANDS = [
    (
        "authLogin",
        "login",
        {"json": {"email": "member@example.com", "password": "correct-password-123"}},
    ),
    (
        "authRegister",
        "register",
        {
            "json": {
                "email": "member@example.com",
                "password": "correct-password-123",
                "display_name": "Member",
            }
        },
    ),
    ("authEmailVerify", "verify_email", {"json": {"token": "one-time-token"}}),
    ("authEmailChangeConfirm", "confirm_email_change", {"json": {"token": "one-time-token"}}),
    (
        "authPasswordResetRequest",
        "request_password_reset",
        {"json": {"email": "member@example.com"}},
    ),
    (
        "authPasswordReset",
        "reset_password",
        {"json": {"token": "one-time-token", "new_password": "password-new-123"}},
    ),
]


@pytest.mark.parametrize("identity,method,payload", PUBLIC_COMMANDS)
@pytest.mark.parametrize("cookie", [AUTH_COOKIE_NAME])
def test_public_auth_operations_accept_stale_cookies_without_csrf(
    customer, identity, method, payload, cookie
):
    client, service, routes = customer
    client.cookies.set(cookie, "stale-cookie")
    response = client.post(routes[identity].path, **payload)
    expected_status = (
        200 if identity in {"authLogin", "authEmailVerify", "authEmailChangeConfirm"} else 204
    )
    assert response.status_code == expected_status, response.text
    if expected_status == 204:
        assert response.content == b""
    getattr(service, method).assert_called_once()


@pytest.mark.parametrize("identity,method,payload", PUBLIC_COMMANDS)
@pytest.mark.parametrize("origin_header", ["Origin", "Referer"])
def test_exemption_preserves_origin_validation(customer, identity, method, payload, origin_header):
    client, service, routes = customer
    client.cookies.set(AUTH_COOKIE_NAME, "stale-cookie")
    response = client.post(
        routes[identity].path, headers={origin_header: "https://untrusted.example/"}, **payload
    )
    assert response.status_code == 403
    assert response.json()["code"] == "request_origin_invalid"
    getattr(service, method).assert_not_called()


@pytest.mark.parametrize("cookie", [AUTH_COOKIE_NAME])
def test_logout_requires_matching_csrf_with_customer_cookies(customer, cookie):
    client, service, routes = customer
    client.cookies.set(cookie, "session-cookie")
    client.cookies.set(CSRF_COOKIE_NAME, "matching-token")
    for headers in ({}, {CSRF_HEADER_NAME: "wrong-token"}):
        response = client.post(routes["authLogout"].path, headers=headers)
        assert response.status_code == 403
        assert response.json()["code"] == "csrf_token_invalid"
    service.revoke_session.assert_not_called()
    response = client.post(routes["authLogout"].path, headers={CSRF_HEADER_NAME: "matching-token"})
    assert response.status_code == 204
    assert response.content == b""
    service.revoke_session.assert_called_once()


def admitted():
    return {"admitted": True}


def security_app():
    app = HttpApplication()
    app.add_middleware(
        CsrfProtectionMiddleware,
        csrf_settings=_csrf_settings(get_context().settings),
        **CUSTOMER_HTTP_ERRORS,
    )
    return app


@pytest.mark.parametrize("identity", sorted(CUSTOMER_CSRF_EXEMPT_OPERATION_IDS))
def test_semantic_identity_controls_exemption_independently_of_url(identity):
    app = security_app()
    inner = APIRouter()
    inner.add_api_route(
        "/arbitrary/{item_id:int}", admitted, methods=["POST"], operation_id=identity
    )
    outer = APIRouter()
    outer.include_router(inner, prefix="/unrelated")
    app.include_router(outer, prefix=CUSTOMER_API_PREFIX)
    with TestClient(app) as client:
        client.cookies.set(AUTH_COOKIE_NAME, "stale-cookie")
        response = client.post(f"{CUSTOMER_API_PREFIX}/unrelated/arbitrary/42")
    assert response.status_code == 200 and response.json() == {"admitted": True}


@pytest.mark.parametrize(
    "case",
    [
        "new_operation",
        "missing_identity",
        "method_mismatch",
        "unknown_route",
        "shadowed_operation",
        "non_api_route",
    ],
)
def test_only_a_full_match_to_an_explicit_exempt_operation_skips_csrf(case):
    app = security_app()
    path = f"{CUSTOMER_API_PREFIX}/auth/email/sensitive-write"
    if case == "new_operation":
        app.add_api_route(path, admitted, methods=["POST"], operation_id="accountSensitiveWrite")
    elif case == "missing_identity":
        app.add_api_route(path, admitted, methods=["POST"])
    elif case == "method_mismatch":
        app.add_api_route(path, admitted, methods=["GET"], operation_id="authRefresh")
    elif case == "shadowed_operation":
        app.add_api_route(path, admitted, methods=["POST"], operation_id="accountSensitiveWrite")
        app.add_api_route(path, admitted, methods=["POST"], operation_id="authRefresh")
    elif case == "non_api_route":

        def starlette_handler(request):
            return JSONResponse({"admitted": True})

        app.router.routes.append(
            Route(path, starlette_handler, methods=["POST"], name="authRefresh")
        )
    with TestClient(app) as client:
        client.cookies.set(AUTH_COOKIE_NAME, "session")
        rejected = client.post(path)
        assert rejected.status_code == 403
        assert rejected.json()["code"] == "csrf_token_invalid"
        client.cookies.set(CSRF_COOKIE_NAME, "token")
        admitted_request = client.post(path, headers={CSRF_HEADER_NAME: "token"})
        assert admitted_request.status_code == {"unknown_route": 404, "method_mismatch": 405}.get(
            case, 200
        )


def test_customer_security_composition_supplies_a_semantic_operation_policy():
    assert _csrf_settings(get_context().settings).exempt_operation is customer_csrf_exempt_operation
    assert {name for name, _, _ in PUBLIC_COMMANDS} == CUSTOMER_CSRF_EXEMPT_OPERATION_IDS
    routes = {
        route.operation_id: route
        for route in iter_route_contexts(create_app().routes)
        if getattr(route, "operation_id", None)
    }
    assert all(
        routes[identity].methods == {"POST"} for identity in CUSTOMER_CSRF_EXEMPT_OPERATION_IDS
    )
    assert not customer_csrf_exempt_operation(routes["authLogout"])
    assert {field.name for field in fields(CookieCsrfSettings)} == {
        "api_prefix",
        "session_cookie_names",
        "csrf_cookie_name",
        "csrf_header_name",
        "exempt_operation",
        "allowed_origins",
        "debug",
    }
    # Composition and exemption evaluation consume semantic policy and framework
    # matches. Endpoint topology belongs to the routes, including future writes.
    for function in (
        _csrf_settings,
        CsrfProtectionMiddleware._requires_csrf_token,
        customer_csrf_exempt_operation,
    ):
        tree = ast.parse(dedent(inspect.getsource(function)))
        strings = [
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
        ]
        assert not any(value.startswith("/") for value in strings)
