from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.deps import get_db
from app.core.config import settings
from app.main import app
from app.modules.playback.router import get_playback_service
from app.modules.playback.service import PlaybackDelivery


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


def test_external_musicxml_content_routes_are_absent(client: TestClient) -> None:
    schema = client.get("/api/v1/openapi.json").json()
    paths = schema["paths"]

    assert "/api/v1/score-grants/{token}/content" not in paths
    assert "/api/v1/publications/{slug}/content" not in paths

    for path in (
        "/api/v1/score-grants/share-token/content",
        "/api/v1/publications/public-score/content",
    ):
        response = client.get(path)
        assert response.status_code == 404, path


def test_external_playback_routes_stream_audio(client: TestClient, tmp_path) -> None:
    audio_path = tmp_path / "playback.wav"
    audio_path.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt ")

    class FakePlaybackService:
        async def grant_delivery(self, db, token: str, user_id: int | None):
            return PlaybackDelivery(
                filename=f"{token}.wav",
                media_type="audio/wav",
                path=str(audio_path),
            )

        async def public_delivery(self, db, slug: str, user_id: int | None):
            return PlaybackDelivery(
                filename=f"{slug}.wav",
                media_type="audio/wav",
                path=str(audio_path),
            )

    async def fake_get_db():
        yield object()

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_playback_service] = lambda: FakePlaybackService()
    try:
        grant_response = client.get("/api/v1/score-grants/share-token/playback")
        public_response = client.get("/api/v1/publications/public-score/playback")
    finally:
        app.dependency_overrides.pop(get_playback_service, None)
        app.dependency_overrides.pop(get_db, None)

    assert grant_response.status_code == 200
    assert grant_response.headers["content-type"].startswith("audio/wav")
    assert public_response.status_code == 200
    assert public_response.headers["content-type"].startswith("audio/wav")


def test_protected_endpoints_require_authentication(client: TestClient) -> None:
    protected_paths = [
        "/api/v1/import-jobs/test-job",
        "/api/v1/scores/test-score",
        "/api/v1/me/profile",
    ]

    for path in protected_paths:
        response = client.get(path)
        assert response.status_code == 401, path


def test_jobs_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("post", "/api/v1/import-jobs", {"file_ids": ["file-1"]}),
        ("get", "/api/v1/import-jobs/test-job", None),
        ("post", "/api/v1/import-jobs/status/batch", {"job_ids": ["job-1"]}),
        ("delete", "/api/v1/import-jobs/test-job", None),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_scores_feature_routes_require_authentication(client: TestClient) -> None:
    protected_requests = [
        ("get", "/api/v1/scores/test-score", None),
        ("patch", "/api/v1/scores/test-score", {"title": "Updated", "expected_version": 1}),
        (
            "post",
            "/api/v1/scores/test-score/revisions",
            {
                "content": "<score-partwise version='4.0'/>",
                "base_revision_id": "revision-1",
            },
        ),
        ("get", "/api/v1/scores/test-score/revisions/revision-1/content", None),
        ("get", "/api/v1/scores/test-score/revision-assets", None),
        ("get", "/api/v1/revision-sources/source-1/download", None),
        ("get", "/api/v1/revision-sources/source-1/access-url", None),
        ("get", "/api/v1/render-assets/render-asset-1/download", None),
        ("get", "/api/v1/render-assets/render-asset-1/access-url", None),
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
        ("post", "/api/v1/library/entries/batch-add-owned", {"score_ids": ["score-1"]}),
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
        ("get", "/api/v1/me/profile", None),
        ("put", "/api/v1/me/profile", {"display_name": "New Name"}),
        ("post", "/api/v1/me/avatar", None),
        ("delete", "/api/v1/me/avatar", None),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_account_security_routes_require_authentication(client: TestClient) -> None:
    response = client.put(
        "/api/v1/me/password",
        json={"current_password": "old", "new_password": "new-password"},
    )

    assert response.status_code == 401


def test_legacy_profile_routes_are_absent(client: TestClient) -> None:
    protected_requests = [
        ("get", "/api/v1/profile", None),
        ("put", "/api/v1/profile", {"display_name": "New Name"}),
        ("post", "/api/v1/profile/avatar", None),
        ("delete", "/api/v1/profile/avatar", None),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 404, f"{method.upper()} {path}"


def test_cookie_authenticated_writes_require_csrf_header(client: TestClient) -> None:
    client.cookies.set(settings.AUTH_COOKIE_NAME, "invalid-token")
    client.cookies.set(settings.CSRF_COOKIE_NAME, "csrf-token")

    try:
        missing_header = client.put(
            "/api/v1/me/profile",
            json={"display_name": "New Name"},
            headers={"X-Request-ID": "csrf-contract"},
        )
        assert missing_header.status_code == 403
        missing_header_payload = missing_header.json()
        assert missing_header_payload["success"] is False
        assert missing_header_payload["public_code"] == "csrf_token_invalid"
        assert missing_header_payload["request_id"] == "csrf-contract"
        assert missing_header.headers["X-Request-ID"] == "csrf-contract"

        matching_header = client.put(
            "/api/v1/me/profile",
            json={"display_name": "New Name"},
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


def test_cors_origin_header_is_emitted_for_configured_frontend(client: TestClient) -> None:
    response = client.get(
        "/api/v1/me/profile",
        headers={"origin": "http://localhost:9002"},
    )

    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == "http://localhost:9002"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cookie_authenticated_writes_reject_cross_site_origin(client: TestClient) -> None:
    client.cookies.set(settings.REFRESH_COOKIE_NAME, "invalid-refresh-token")

    try:
        response = client.post(
            "/api/v1/auth/refresh",
            headers={"origin": "https://evil.example", "X-Request-ID": "origin-contract"},
        )
        assert response.status_code == 403
        payload = response.json()
        assert payload["success"] is False
        assert payload["public_code"] == "request_origin_invalid"
        assert payload["request_id"] == "origin-contract"
        assert response.headers["X-Request-ID"] == "origin-contract"
    finally:
        client.cookies.delete(settings.REFRESH_COOKIE_NAME)


def test_login_requires_request_body(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", headers={"X-Request-ID": "validation-contract"})
    assert response.status_code == 422
    payload = response.json()
    assert payload["success"] is False
    assert payload["public_code"] == "validation_error"
    assert payload["request_id"] == "validation-contract"
    assert response.headers["X-Request-ID"] == "validation-contract"
