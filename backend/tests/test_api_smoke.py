from __future__ import annotations

from fastapi.testclient import TestClient


def _request(
    client: TestClient,
    method: str,
    path: str,
    payload: dict | None = None,
):
    kwargs = {}
    if payload is not None:
        kwargs["json"] = payload
    return getattr(client, method)(path, **kwargs)


def test_root_endpoint(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "operational"
    assert "docs" in payload


def test_docs_endpoints(client: TestClient) -> None:
    docs_response = client.get("/docs")
    redoc_response = client.get("/redoc")
    openapi_response = client.get("/api/v1/openapi.json")

    assert docs_response.status_code == 200
    assert redoc_response.status_code == 200
    assert openapi_response.status_code == 200


def test_protected_endpoints_require_authentication(client: TestClient) -> None:
    protected_paths = [
        "/api/v1/tasks",
        "/api/v1/profile",
        "/api/v1/shares",
        "/api/v1/xml/test-task/xml",
        "/api/v1/files/tasks/test-task",
    ]

    for path in protected_paths:
        response = client.get(path)
        assert response.status_code == 401, path


def test_tasks_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("get", "/api/v1/tasks", None),
        ("get", "/api/v1/tasks/test-task/details", None),
        ("patch", "/api/v1/tasks/test-task", {"title": "Updated"}),
        ("post", "/api/v1/tasks/submit-batch", {"file_ids": ["file-1"]}),
        ("delete", "/api/v1/tasks/test-task", None),
        ("post", "/api/v1/tasks/batch-delete", {"task_ids": ["task-1"]}),
        ("post", "/api/v1/tasks/status/batch", {"task_ids": ["task-1"]}),
        ("post", "/api/v1/tasks/archive", {"task_ids": ["task-1"], "include_types": ["png"]}),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_files_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("post", "/api/v1/files/upload", None),
        ("get", "/api/v1/files/tasks/test-task", None),
        ("get", "/api/v1/files/download/final_xml/test-task", None),
        ("get", "/api/v1/files/preview/test.png", None),
        ("delete", "/api/v1/files/test.png", None),
        ("post", "/api/v1/files/export/excel", {"task_ids": ["task-1"]}),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_shares_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("get", "/api/v1/shares", None),
        ("post", "/api/v1/shares", {"task_id": "task-1"}),
        ("get", "/api/v1/shares/fake-token", None),
        ("delete", "/api/v1/shares/fake-token", None),
        ("post", "/api/v1/shares/fake-token/revoke", None),
        ("get", "/api/v1/shares/fake-token/download/final_xml", None),
        ("get", "/api/v1/shares/fake-token/download/archive", None),
        ("get", "/api/v1/shares/saved-shares", None),
        ("post", "/api/v1/shares/save", {"token": "fake-token"}),
        ("post", "/api/v1/shares/saved-shares/batch-delete", {"ids": [1]}),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_xml_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("get", "/api/v1/xml/test-task/xml", None),
        ("post", "/api/v1/xml/test-task/xml", {"content": "<score-partwise />"}),
        ("post", "/api/v1/xml/test-task/confirm", {}),
        ("post", "/api/v1/xml/test-task/fingering", {}),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_profile_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("get", "/api/v1/profile", None),
        ("put", "/api/v1/profile", {"email": "new@example.com"}),
        ("post", "/api/v1/profile/password", {"current_password": "old", "new_password": "new"}),
        ("post", "/api/v1/profile/avatar", None),
        ("delete", "/api/v1/profile/avatar", None),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_login_requires_request_body(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login")
    assert response.status_code == 422
