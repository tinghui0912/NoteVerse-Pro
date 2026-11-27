from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
import os

for name, value in {
    "S3_ENDPOINT_URL": "https://storage.example.test",
    "S3_BUCKET": "unit-tests",
    "S3_ACCESS_KEY_ID": "test-key",
    "S3_SECRET_ACCESS_KEY": "test-secret",
}.items():
    os.environ.setdefault(name, value)


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def exporter_client() -> Iterator[TestClient]:
    from app.observability_main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def isolated_revision_post_commit_relay(monkeypatch):
    """Business transaction tests do not publish to an external broker.

    Relay protocol tests install their controlled producer explicitly.
    """
    from unittest.mock import Mock
    from app.modules.revisions.post_commit import revision_post_commit

    monkeypatch.setattr(revision_post_commit, "dispatch_best_effort", Mock())


@pytest.fixture(autouse=True)
def isolated_retirement_immediate_dispatch(monkeypatch):
    from unittest.mock import Mock

    monkeypatch.setattr(
        "app.worker.dispatch.stored_object_retirement.dispatch_retirements_best_effort", Mock()
    )


@pytest.fixture(autouse=True)
def isolated_score_deletion_immediate_dispatch(monkeypatch):
    from unittest.mock import Mock

    monkeypatch.setattr(
        "app.worker.dispatch.score_deletion.dispatch_score_deletion_best_effort", Mock()
    )


@pytest.fixture
def postgres_engine(monkeypatch):
    from sqlmodel import SQLModel
    from tests.support.postgres_schema import postgres_schema_database

    with postgres_schema_database(monkeypatch) as (engine, _):
        SQLModel.metadata.create_all(engine)
        yield engine
