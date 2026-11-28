"""Fixtures for the isolated Control Plane HTTP contract."""

import pytest
from tests.support.browser import BrowserTestClient as TestClient
from sqlalchemy.orm import Session
from sqlmodel import SQLModel
from app.platform.db.dependencies import get_db
from app.modules.platform_operators.management_service import create_operator
from app.platform.security.totp import code_for_step
from app.shared.time import utc_now
from app.modules.platform_operators.domain import OperatorRole
from app.runtime.control_plane.context import get_context as get_control_context


@pytest.fixture
def control_app(monkeypatch):
    for key, value in {
        "CONTROL_PLANE_COOKIE_SECURE": "false",
        "CONTROL_PLANE_CORS_ORIGINS": '["http://testserver", "https://testserver"]',
    }.items():
        monkeypatch.setenv(key, value)
    get_control_context.cache_clear()
    from app.runtime.control_plane.main import create_app

    app = create_app()
    yield app
    app.dependency_overrides.clear()
    get_control_context.cache_clear()


@pytest.fixture
def control_db(postgres_engine, control_app):
    engine = postgres_engine
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:

        def dependency():
            yield db

        control_app.dependency_overrides[get_db] = dependency
        yield db
    engine.dispose()


@pytest.fixture
def operator_client(control_app, control_db):
    create_operator(
        control_db,
        email="operator@example.com",
        password="a-long-operator-password",
        display_name="Operator",
        role=OperatorRole.SUPER_ADMIN,
    )
    control_db.commit()
    with TestClient(control_app, raise_server_exceptions=False) as client:
        enroll_operator(client)
        yield client


def enroll_operator(client, *, email="operator@example.com", password="a-long-operator-password"):
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    assert response.json()["purpose"] == "ENROLLMENT_REQUIRED"

    headers = {}
    response = client.post("/api/v1/auth/mfa/enroll/start", headers=headers)
    assert response.status_code == 200, response.text
    secret = response.json()["secret"]
    response = client.post(
        "/api/v1/auth/mfa/enroll/confirm",
        json={"code": code_for_step(secret, int(utc_now().timestamp()) // 30)},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return secret, response.json()["recovery_codes"]


def operator_policy():
    from app.runtime.control_plane.settings import ControlPlaneSettings

    return ControlPlaneSettings().to_security_settings()
