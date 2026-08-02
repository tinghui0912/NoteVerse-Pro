from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app.db.models import SchedulerHeartbeat, SchedulerLeaderStatus
from app.observability.async_operation_metrics import (
    _scheduler_heartbeat_lines,
    _scheduler_leader_lines,
)
from app.modules.scheduler_lock.constants import BEAT_LEADER_SCHEDULER_NAME


def test_scheduler_heartbeat_metrics_read_orm_entities() -> None:
    heartbeat = SchedulerHeartbeat(job_key="render_outbox")

    class ScalarResult:
        def all(self) -> list[SchedulerHeartbeat]:
            return [heartbeat]

    class Result:
        def scalars(self) -> ScalarResult:
            return ScalarResult()

    class Session:
        async def exec(self, _statement: object) -> Result:
            return Result()

    lines = asyncio.run(_scheduler_heartbeat_lines(Session()))

    assert 'noteverse_scheduler_lock_acquired_total{scheduler_job="render_outbox"} 0' in lines


def test_scheduler_leader_metrics_read_dedicated_orm_entity() -> None:
    status = SchedulerLeaderStatus(
        scheduler_name=BEAT_LEADER_SCHEDULER_NAME,
        acquired_count=2,
        standby_count=3,
        child_exit_count=1,
    )

    class Session:
        async def get(self, _model: object, identity: object) -> SchedulerLeaderStatus:
            assert identity == BEAT_LEADER_SCHEDULER_NAME
            return status

    lines = asyncio.run(_scheduler_leader_lines(Session()))

    assert "noteverse_scheduler_leader_acquisitions_total 2" in lines
    assert "noteverse_scheduler_leader_standby_total 3" in lines
    assert "noteverse_scheduler_leader_child_exits_total 1" in lines


def test_exporter_metrics_endpoint_exposes_durable_projection(
    exporter_client: TestClient,
    monkeypatch,
) -> None:
    async def durable_metrics(_db: object) -> str:
        return "noteverse_scheduler_lag_seconds{operation_kind=\"render\"} 0\n"

    monkeypatch.setattr("app.api.metrics.async_operation_metrics_text", durable_metrics)

    response = exporter_client.get("/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "noteverse_http_requests_total" in response.text
    assert "noteverse_scheduler_lag_seconds" in response.text


def test_http_metrics_use_route_template_labels(client: TestClient) -> None:
    client.get("/")

    response = client.get("/metrics")

    assert response.status_code == 200
    assert 'noteverse_http_requests_total{method="GET",route="/",status_code="200"}' in response.text
    assert 'route="/metrics"' not in response.text


def test_customer_metrics_exclude_durable_database_metrics(client: TestClient) -> None:
    response = client.get("/metrics")

    assert response.status_code == 200
    assert "noteverse_http_requests_total" in response.text
    assert "noteverse_import_jobs_by_state" not in response.text
    assert "noteverse_scheduler_lag_seconds" not in response.text
