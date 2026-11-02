from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient


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
def isolated_revision_derivative_relay(monkeypatch):
    """Business transaction tests do not publish to an external broker.

    Relay protocol tests install their controlled producer explicitly.
    """
    from unittest.mock import AsyncMock, Mock
    from app.modules.revisions.derivatives import revision_derivative_service
    monkeypatch.setattr(revision_derivative_service, "dispatch_after_commit", AsyncMock())
    monkeypatch.setattr(revision_derivative_service, "dispatch_after_commit_sync", Mock())
