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
