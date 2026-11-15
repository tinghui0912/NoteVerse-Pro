"""Fixtures for the isolated Control Plane HTTP contract."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel
from app.api.deps import get_db
from app.core.control_plane_settings import get_control_plane_runtime_settings
from app.modules.platform_operators.service import OperatorAuthenticationService


@pytest.fixture
def control_app(monkeypatch):
    for key, value in {
        "CONTROL_PLANE_COOKIE_SECURE": "false",
        "CONTROL_PLANE_COOKIE_SAMESITE": "lax",
        "CONTROL_PLANE_SESSION_EXPIRE_MINUTES": "30",
        "CONTROL_PLANE_CORS_ORIGINS": '["http://testserver"]',
    }.items():
        monkeypatch.setenv(key, value)
    get_control_plane_runtime_settings.cache_clear()
    from app.control_plane_main import create_app

    app = create_app()
    yield app
    app.dependency_overrides.clear()
    get_control_plane_runtime_settings.cache_clear()


@pytest.fixture
def control_db(control_app):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
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
