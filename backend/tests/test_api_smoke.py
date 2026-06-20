from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings


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


def test_public_xml_source_contract_excludes_pipeline_artifacts(client: TestClient) -> None:
    schema = client.get("/api/v1/openapi.json").json()
    path = next(path for path in schema["paths"] if path.endswith("/xml/{task_id}/xml"))
    parameters = schema["paths"][path]["get"]["parameters"]
    source = next(parameter for parameter in parameters if parameter["name"] == "source")

    assert source["required"] is True
    assert source["schema"]["enum"] == ["final", "current"]


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
        ("post", "/api/v1/tasks/archive", {"task_ids": ["task-1"], "include_types": ["image"]}),
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


def test_cookie_authenticated_writes_require_csrf_header(client: TestClient) -> None:
    client.cookies.set(settings.AUTH_COOKIE_NAME, "invalid-token")
    client.cookies.set(settings.CSRF_COOKIE_NAME, "csrf-token")

    try:
        missing_header = client.put("/api/v1/profile", json={"email": "new@example.com"})
        assert missing_header.status_code == 403
        assert missing_header.json()["code"] == "csrf_token_invalid"

        matching_header = client.put(
            "/api/v1/profile",
            json={"email": "new@example.com"},
            headers={settings.CSRF_HEADER_NAME: "csrf-token"},
        )
        assert matching_header.status_code == 401
    finally:
        client.cookies.delete(settings.AUTH_COOKIE_NAME)
        client.cookies.delete(settings.CSRF_COOKIE_NAME)


def test_refresh_endpoint_is_csrf_exempt(client: TestClient) -> None:
    client.cookies.set(settings.REFRESH_COOKIE_NAME, "invalid-refresh-token")

    try:
        response = client.post("/api/v1/auth/refresh")
        assert response.status_code == 401
    finally:
        client.cookies.delete(settings.REFRESH_COOKIE_NAME)


def test_cookie_authenticated_writes_allow_loopback_dev_origin(client: TestClient) -> None:
    client.cookies.set(settings.REFRESH_COOKIE_NAME, "invalid-refresh-token")

    try:
        response = client.post(
            "/api/v1/auth/refresh",
            headers={"host": "localhost:8000", "origin": "http://localhost:9002"},
        )
        assert response.status_code == 401
    finally:
        client.cookies.delete(settings.REFRESH_COOKIE_NAME)


def test_cookie_authenticated_writes_reject_cross_site_origin(client: TestClient) -> None:
    client.cookies.set(settings.REFRESH_COOKIE_NAME, "invalid-refresh-token")

    try:
        response = client.post(
            "/api/v1/auth/refresh",
            headers={"origin": "https://evil.example"},
        )
        assert response.status_code == 403
        assert response.json()["code"] == "request_origin_invalid"
    finally:
        client.cookies.delete(settings.REFRESH_COOKIE_NAME)


def test_login_requires_request_body(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login")
    assert response.status_code == 422
