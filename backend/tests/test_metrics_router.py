from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.metrics import create_metrics_router


def test_process_only_metrics_do_not_query_or_export_database_state() -> None:
    app = FastAPI()
    app.include_router(create_metrics_router(include_database_metrics=False))

    response = TestClient(app).get("/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "noteverse_scheduler_leader_active" not in response.text
    assert "noteverse_outbox_records_by_status" not in response.text
