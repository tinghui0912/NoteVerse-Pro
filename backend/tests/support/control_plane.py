"""Fixtures for the isolated Control Plane HTTP contract."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from sqlmodel import SQLModel
from app.platform.db.dependencies import get_db
from app.modules.platform_operators.service import OperatorAuthenticationService
from app.runtime.control_plane.context import get_context as get_control_context


@pytest.fixture
def control_app(monkeypatch):
    for key, value in {
        "CONTROL_PLANE_COOKIE_SECURE": "false",
        "CONTROL_PLANE_COOKIE_SAMESITE": "lax",
        "CONTROL_PLANE_SESSION_EXPIRE_MINUTES": "30",
        "CONTROL_PLANE_CORS_ORIGINS": '["http://testserver"]',
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
    OperatorAuthenticationService().create_local_operator(
        control_db,
        username="operator@example.test",
        password="a-long-operator-password",
        display_name="Operator",
    )
    with TestClient(control_app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/auth/login",
            json={"username": "operator@example.test", "password": "a-long-operator-password"},
        )
        assert response.status_code == 204 and response.content == b""
        yield client


def operator_policy():
    from app.runtime.control_plane.settings import ControlPlaneSettings

    return ControlPlaneSettings().to_security_settings()
