from __future__ import annotations

from fastapi.testclient import TestClient


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
