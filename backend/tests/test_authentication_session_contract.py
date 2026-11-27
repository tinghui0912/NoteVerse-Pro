"""Login admits a principal with its session; recovery clears browser authority."""

from http.cookies import SimpleCookie

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core import security
from app.core.generated.customer_browser_protocol import (
    AUTH_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    CSRF_COOKIE_NAME,
)
from app.db.models import User, RefreshToken
from app.main import app
from app.modules.account.profile_service import ProfileService
from app.modules.auth.password_reset_service import PasswordResetService
from app.modules.auth.schemas import ForgotPasswordRequest
from app.modules.auth.service import AuthService


@pytest.fixture
def auth_client(postgres_engine):
    with Session(postgres_engine) as db:
        db.add(
            User(
                id=1,
                email="login@example.com",
                display_name="Login User",
                password_hash=security.get_password_hash("password"),
            )
        )
        db.commit()
        app.dependency_overrides[get_db] = lambda: db
        try:
            with TestClient(app, base_url="https://testserver") as client:
                yield db, client
        finally:
            app.dependency_overrides.pop(get_db, None)


def login(client):
    return client.post(
        "/api/v1/auth/login", data={"username": "login@example.com", "password": "password"}
    )


def test_login_returns_the_authenticated_account_principal_and_session_cookies(auth_client):
    db, client = auth_client
    response = login(client)
    assert response.status_code == 200, response.text
    assert response.json() == ProfileService().profile_payload(db.get(User, 1)).user.model_dump(
        mode="json"
    )
    assert set(client.cookies) == {AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME, CSRF_COOKIE_NAME}
    assert (
        db.scalar(
            select(func.count()).select_from(RefreshToken).where(RefreshToken.revoked_at.is_(None))
        )
        == 1
    )
    schema = app.openapi()["paths"]["/api/v1/auth/login"]["post"]["responses"]
    assert schema["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ProfileUserRead"
    }
    assert "204" not in schema


@pytest.mark.parametrize("invalid", ["password", "inactive"])
def test_rejected_login_admits_neither_session_nor_principal(auth_client, invalid):
    db, client = auth_client
    if invalid == "inactive":
        db.get(User, 1).is_active = False
        db.commit()
    response = client.post(
        "/api/v1/auth/login",
        data={
            "username": "login@example.com",
            "password": "wrong" if invalid == "password" else "password",
        },
    )
    assert response.status_code == 401
    assert response.json()["code"] == (
        "invalid_credentials" if invalid == "password" else "account_inactive"
    )
    assert db.scalar(select(func.count()).select_from(RefreshToken)) == 0
    assert not response.headers.get_list("set-cookie")


@pytest.mark.parametrize("authenticated_browser", [True, False])
def test_password_reset_revokes_all_sessions_and_clears_current_browser_cookies(
    auth_client, monkeypatch, authenticated_browser
):
    db, client = auth_client
    response = login(client)
    assert response.status_code == 200
    old_access = client.cookies[AUTH_COOKIE_NAME]
    AuthService().login(db, "login@example.com", "password", user_agent="another browser")
    service = PasswordResetService()
    monkeypatch.setattr(service, "_new_token", lambda: "reset-token")
    service.request_password_reset(
        db, ForgotPasswordRequest(email="login@example.com", locale="en")
    )
    if not authenticated_browser:
        client.cookies.clear()
    reset = client.post(
        "/api/v1/auth/password/reset",
        json={"token": "reset-token", "new_password": "new-password", "locale": "en"},
    )
    assert reset.status_code == 204 and reset.content == b""
    cookies = SimpleCookie()
    for header in reset.headers.get_list("set-cookie"):
        cookies.load(header)
    assert set(cookies) == {AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME, CSRF_COOKIE_NAME}
    assert all(cookie["max-age"] == "0" for cookie in cookies.values())
    assert not client.cookies
    db.expire_all()
    user = db.get(User, 1)
    assert security.verify_password("new-password", user.password_hash)
    assert user.password_changed_at is not None
    tokens = list(db.scalars(select(RefreshToken)))
    assert len(tokens) == 2 and all(token.revoked_at is not None for token in tokens)
    client.cookies.set(AUTH_COOKIE_NAME, old_access)
    denied = client.get("/api/v1/me/profile")
    assert denied.status_code == 401 and denied.json()["code"] == "token_invalid_expired"
