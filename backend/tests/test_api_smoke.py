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


def test_legacy_task_as_score_routes_are_absent(client: TestClient) -> None:
    schema = client.get("/api/v1/openapi.json").json()
    paths = schema["paths"]
    assert not any(path.startswith("/api/v1/tasks") for path in paths)
    assert not any(path.startswith("/api/v1/xml") for path in paths)
    assert not any(path.startswith("/api/v1/shares") for path in paths)


def test_protected_endpoints_require_authentication(client: TestClient) -> None:
    protected_paths = [
        "/api/v1/jobs/test-job",
        "/api/v1/scores/test-score",
        "/api/v1/profile",
    ]

    for path in protected_paths:
        response = client.get(path)
        assert response.status_code == 401, path


def test_jobs_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("post", "/api/v1/jobs", {"file_ids": ["file-1"]}),
        ("get", "/api/v1/jobs/test-job", None),
        ("post", "/api/v1/jobs/status/batch", {"job_ids": ["job-1"]}),
        ("delete", "/api/v1/jobs/test-job", None),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_scores_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("get", "/api/v1/scores/test-score", None),
        ("patch", "/api/v1/scores/test-score", {"title": "Updated", "expected_version": 1}),
        ("delete", "/api/v1/scores/test-score", None),
        ("post", "/api/v1/scores/test-score/approve", None),
        ("get", "/api/v1/scores/test-score/revisions", None),
        (
            "post",
            "/api/v1/scores/test-score/revisions",
            {
                "content": "<score-partwise version='4.0'/>",
                "base_revision_id": "revision-1",
            },
        ),
        ("get", "/api/v1/scores/test-score/revisions/revision-1/content", None),
        ("get", "/api/v1/scores/test-score/artifacts", None),
        ("post", "/api/v1/scores/test-score/revisions/revision-1/render", None),
        ("get", "/api/v1/scores/test-score/revisions/revision-1/metadata", None),
        ("post", "/api/v1/scores/test-score/revisions/revision-1/metadata/rebuild", None),
        ("get", "/api/v1/artifacts/artifact-1/download", None),
        ("get", "/api/v1/artifacts/artifact-1/access-url", None),
        ("post", "/api/v1/scores/test-score/grants", {}),
        ("get", "/api/v1/scores/test-score/grants", None),
        ("post", "/api/v1/scores/test-score/invites", {}),
        ("get", "/api/v1/scores/test-score/invites", None),
        ("post", "/api/v1/scores/test-score/invites/invite-1/revoke", None),
        ("delete", "/api/v1/scores/test-score/invites/invite-1", None),
        ("get", "/api/v1/scores/test-score/members", None),
        ("patch", "/api/v1/scores/test-score/members/1", {"role": "EDITOR"}),
        ("delete", "/api/v1/scores/test-score/members/1", None),
        ("post", "/api/v1/invites/invite-token/accept", None),
        ("put", "/api/v1/scores/test-score/publication", {}),
        ("delete", "/api/v1/scores/test-score/publication", None),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_library_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("get", "/api/v1/library/folders", None),
        ("post", "/api/v1/library/folders", {"name": "Practice"}),
        ("patch", "/api/v1/library/folders/folder-1", {"name": "Updated"}),
        ("delete", "/api/v1/library/folders/folder-1", None),
        ("get", "/api/v1/library/entries", None),
        ("post", "/api/v1/library/entries/batch-move", {"entry_ids": ["entry-1"]}),
        ("post", "/api/v1/library/entries/batch-favorite", {"entry_ids": ["entry-1"]}),
        ("post", "/api/v1/library/entries/batch-trash", {"entry_ids": ["entry-1"]}),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_my_scores_feature_routes_require_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/my-scores")

    assert response.status_code == 401


def test_files_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("post", "/api/v1/files/upload", None),
        ("delete", "/api/v1/files/test.png", None),
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
