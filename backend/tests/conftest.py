from __future__ import annotations


from collections.abc import Iterator
from sqlalchemy import event
from sqlmodel import SQLModel
from app.platform.db.authorization import install_security_functions


import pytest
from fastapi.testclient import TestClient
import os

for name, value in {
    "LEGATO_REPO_PATH": "/tmp/legato",
    "PLAYBACK_SOUNDFONT_PATH": "/tmp/test.sf2",
    "CONTROL_PLANE_COOKIE_SECURE": "false",
    "OPERATOR_TOTP_ENCRYPTION_KEY": "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
    "CONTROL_PLANE_CORS_ORIGINS": '["http://testserver"]',
    "S3_ENDPOINT_URL": "https://storage.example.test",
    "S3_BUCKET": "unit-tests",
    "S3_ACCESS_KEY_ID": "test-key",
    "S3_SECRET_ACCESS_KEY": "test-secret",
}.items():
    os.environ.setdefault(name, value)


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    from app.runtime.customer_api.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def exporter_client() -> Iterator[TestClient]:
    from app.runtime.observability.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def isolated_immediate_dispatch(monkeypatch):
    from unittest.mock import Mock
    from app.runtime.customer_api.context import get_context
    from app.composition.dispatch.retirement import StoredObjectRetirementDispatcher
    from app.composition.dispatch.score_deletion import ScoreDeletionDispatcher

    monkeypatch.setattr(get_context().resources.post_commit, "dispatch_best_effort", Mock())
    monkeypatch.setattr(
        StoredObjectRetirementDispatcher, "dispatch_retirements_best_effort", Mock()
    )
    monkeypatch.setattr(ScoreDeletionDispatcher, "dispatch_score_deletion_best_effort", Mock())


@pytest.fixture
def postgres_engine(monkeypatch):
    from sqlmodel import SQLModel
    from tests.support.postgres_schema import postgres_schema_database

    with postgres_schema_database(monkeypatch) as (engine, _):
        SQLModel.metadata.create_all(engine)
        yield engine


@event.listens_for(SQLModel.metadata, "after_create")
def install_database_security_objects(metadata, connection, **kwargs):
    if connection.dialect.name == "postgresql":
        install_security_functions(connection)
