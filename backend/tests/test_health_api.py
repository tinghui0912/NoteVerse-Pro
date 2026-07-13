from __future__ import annotations

from fastapi.testclient import TestClient


def test_liveness_does_not_check_external_dependencies(client: TestClient) -> None:
    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_reports_healthy_dependencies(client: TestClient, monkeypatch) -> None:
    async def available() -> bool:
        return True

    monkeypatch.setattr("app.api.health.check_database_readiness", available)
    monkeypatch.setattr("app.api.health.check_redis_readiness", available)
    monkeypatch.setattr("app.api.health.check_storage_quota_policy_readiness", available)

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "checks": {"database": "ok", "storage_quota_policy": "ok", "redis": "ok"},
    }


def test_redis_failure_degrades_but_does_not_remove_api_traffic(client: TestClient, monkeypatch) -> None:
    async def available() -> bool:
        return True

    async def unavailable() -> bool:
        return False

    monkeypatch.setattr("app.api.health.check_database_readiness", available)
    monkeypatch.setattr("app.api.health.check_redis_readiness", unavailable)
    monkeypatch.setattr("app.api.health.check_storage_quota_policy_readiness", available)

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "degraded",
        "checks": {"database": "ok", "storage_quota_policy": "ok", "redis": "degraded"},
    }


def test_database_failure_marks_api_not_ready(client: TestClient, monkeypatch) -> None:
    async def available() -> bool:
        return True

    async def unavailable() -> bool:
        return False

    monkeypatch.setattr("app.api.health.check_database_readiness", unavailable)
    monkeypatch.setattr("app.api.health.check_redis_readiness", available)
    monkeypatch.setattr("app.api.health.check_storage_quota_policy_readiness", available)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "checks": {"database": "failed", "storage_quota_policy": "failed", "redis": "ok"},
    }


def test_missing_storage_quota_policy_marks_api_not_ready(
    client: TestClient, monkeypatch
) -> None:
    async def available() -> bool:
        return True

    async def unavailable() -> bool:
        return False

    monkeypatch.setattr("app.api.health.check_database_readiness", available)
    monkeypatch.setattr("app.api.health.check_redis_readiness", available)
    monkeypatch.setattr("app.api.health.check_storage_quota_policy_readiness", unavailable)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "checks": {"database": "ok", "storage_quota_policy": "failed", "redis": "ok"},
    }
