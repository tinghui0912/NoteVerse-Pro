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


def test_metrics_endpoint_exposes_prometheus_text(client: TestClient) -> None:
    response = client.get("/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "noteverse_http_requests_total" in response.text
    assert "noteverse_import_jobs_by_state" in response.text
    assert "noteverse_outbox_records_by_status" in response.text
    assert "noteverse_score_deletions_by_status" in response.text
    assert "noteverse_async_operation_oldest_open_age_seconds" in response.text
    assert "noteverse_async_operation_oldest_processing_age_seconds" in response.text
    assert "noteverse_async_operation_completed_duration_average_seconds" in response.text
    assert "noteverse_scheduler_last_success_timestamp_seconds" in response.text
    assert "noteverse_scheduler_last_scan_duration_seconds" in response.text
    assert "noteverse_scheduler_successes_total" in response.text
    assert "noteverse_scheduler_dispatched_records_total" in response.text
    assert "noteverse_scheduler_lock_acquired_total" in response.text
    assert "noteverse_scheduler_lock_skipped_total" in response.text
    assert "noteverse_scheduler_leader_active" in response.text
    assert "noteverse_scheduler_lag_seconds" in response.text
    assert 'noteverse_realtime_active_connections{channel="app_sse"} 0.0' in response.text
    assert (
        'noteverse_realtime_active_connections{channel="practice_websocket"} 0.0'
        in response.text
    )


def test_http_metrics_use_route_template_labels(client: TestClient) -> None:
    client.get("/")

    response = client.get("/metrics")

    assert response.status_code == 200
    assert 'noteverse_http_requests_total{method="GET",route="/",status_code="200"}' in response.text
    assert 'route="/metrics"' not in response.text
