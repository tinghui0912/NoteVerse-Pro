from __future__ import annotations

import pytest

from collections.abc import Iterator
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.main import app
from app.core.middleware import normalize_origin
from app.modules.playback.router import get_playback_delivery_service
from app.modules.playback.delivery import PlaybackDelivery
from app.modules.practice.bundle.router import get_practice_bundle_service


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


def test_request_correlation_replaces_invalid_external_identifier(client: TestClient) -> None:
    response = client.get("/", headers={"X-Request-ID": "unsafe identifier"})

    request_id = response.headers["X-Request-ID"]
    assert response.status_code == 200
    assert request_id != "unsafe identifier"
    assert len(request_id) == 32
    assert all(character in "0123456789abcdef" for character in request_id)


def test_request_correlation_preserves_valid_external_identifier(client: TestClient) -> None:
    response = client.get("/", headers={"X-Request-ID": "release-20260805.1"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "release-20260805.1"


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


def test_external_playback_routes_stream_audio(client: TestClient, tmp_path) -> None:
    audio_bytes = b"RIFF\x24\x00\x00\x00WAVEfmt "
    audio_path = tmp_path / "playback.wav"
    audio_path.write_bytes(audio_bytes)

    class FakePlaybackStorage:
        def read_bytes(self, key: str) -> bytes:
            assert key in {"playback/score-audio.wav"}
            return audio_bytes

        def size_bytes(self, key: str) -> int:
            assert key in {"playback/score-audio.wav"}
            return len(audio_bytes)

        def iter_bytes(
            self,
            key: str,
            *,
            chunk_size: int = 1024 * 1024,
            start: int | None = None,
            end: int | None = None,
        ) -> Iterator[bytes]:
            assert key in {"playback/score-audio.wav"}
            content = audio_bytes[start : end + 1 if end is not None else None]
            for index in range(0, len(content), chunk_size):
                yield content[index : index + chunk_size]

    class FakePlaybackService:
        storage = FakePlaybackStorage()

        async def score_revision_delivery(
            self, db, score_uuid: str, revision_uuid: str, user_id: int
        ):
            token = "score-audio"
            return PlaybackDelivery(
                filename=f"{token}.wav",
                media_type="audio/wav",
                storage_key=f"playback/{token}.wav",
            )

    async def fake_get_db():
        yield object()

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_playback_delivery_service] = lambda: FakePlaybackService()
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, is_active=True)
    try:
        audio_response = client.get("/api/v1/scores/score/revisions/revision/playback")
        audio_range_response = client.get(
            "/api/v1/scores/score/revisions/revision/playback",
            headers={"Range": "bytes=5-8"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_playback_delivery_service, None)
        app.dependency_overrides.pop(get_db, None)

    assert audio_response.status_code == 200
    assert audio_response.headers["content-type"].startswith("audio/wav")
    assert audio_response.content == audio_bytes
    assert audio_range_response.status_code == 206
    assert audio_range_response.headers["content-range"] == f"bytes 5-8/{len(audio_bytes)}"
    assert audio_range_response.content == audio_bytes[5:9]


@pytest.mark.parametrize("include_notation", [False, True])
def test_main_api_serves_one_practice_bundle(client: TestClient, include_notation) -> None:
    calls = []

    class FakePracticeBundleService:
        async def read_bundle(
            self, db, score_uuid, user_id, revision_uuid, *, include_notation=False
        ):
            import json
            import os
            from pathlib import Path

            calls.append((score_uuid, revision_uuid, include_notation))
            root = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
            artifact = json.loads(
                (
                    root
                    / "apps/customer-web/src/lib/practice/__fixtures__/canonical-practice-score-artifact.json"
                ).read_text()
            )
            return {
                "binding": {
                    "score_id": score_uuid,
                    "revision_id": revision_uuid,
                    "bundle_id": "bundle-1",
                },
                "artifact": artifact,
                "notation": {
                    "musicxml": '<score-partwise><note id="nv-p1-m1-note1" /></score-partwise>',
                    "mime_type": "application/vnd.recordare.musicxml+xml",
                }
                if include_notation
                else None,
            }

    async def fake_get_db():
        yield object()

    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, is_active=True)
    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_practice_bundle_service] = lambda: FakePracticeBundleService()
    try:
        response = client.get(
            "/api/v1/practice/scores/score-1/revisions/revision-1/bundle",
            params={"include_notation": include_notation},
        )
    finally:
        app.dependency_overrides.pop(get_practice_bundle_service, None)
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)
    assert response.status_code == 200
    source = response.json()["data"]
    assert source["binding"] == {
        "score_id": "score-1",
        "revision_id": "revision-1",
        "bundle_id": "bundle-1",
    }
    assert "scoreId" not in source["artifact"]
    assert "revisionId" not in source["artifact"]
    assert (source["notation"] is not None) == include_notation
    if include_notation:
        assert 'id="nv-p1-m1-note1"' in source["notation"]["musicxml"]
    assert calls == [("score-1", "revision-1", include_notation)]


def test_main_openapi_includes_practice_bundle_routes(client: TestClient) -> None:
    schema = client.get("/api/v1/openapi.json").json()
    paths = schema["paths"]

    assert "/api/v1/practice/scores/{score_id}/revisions/{revision_id}/bundle" in paths
    assert "/api/v1/practice/scores/{score_id}/revisions/{revision_id}/targets" not in paths
    assert "/api/v1/practice/sessions" not in paths


def test_protected_endpoints_require_authentication(client: TestClient) -> None:
    protected_paths = [
        "/api/v1/import-jobs/test-job",
        "/api/v1/scores/test-score",
        "/api/v1/me/profile",
        "/api/v1/practice/scores/score-1/revisions/revision-1/bundle",
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
                "expected_head_revision_id": "revision-1",
            },
        ),
        ("get", "/api/v1/scores/test-score/revisions/revision-1/content", None),
        ("get", "/api/v1/scores/test-score/revision-assets", None),
        ("get", "/api/v1/revision-sources/source-1/download", None),
        ("get", "/api/v1/revision-sources/source-1/access-url", None),
        ("get", "/api/v1/render-assets/render-asset-1/download", None),
        ("get", "/api/v1/render-assets/render-asset-1/access-url", None),
        ("patch", "/api/v1/scores/test-score/guest-preview", {"enabled": True}),
        ("get", "/api/v1/scores/test-score/guest-preview", None),
        ("post", "/api/v1/scores/test-score/invites", {}),
        ("get", "/api/v1/scores/test-score/invites", None),
        ("post", "/api/v1/scores/test-score/invites/invite-1/revoke", None),
        ("get", "/api/v1/scores/test-score/members", None),
        ("patch", "/api/v1/scores/test-score/members/1", {"role": "EDITOR"}),
        ("delete", "/api/v1/scores/test-score/members/1", None),
        ("post", "/api/v1/invites/invite-token/accept", None),
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
        ("get", "/api/v1/library/scores", None),
        ("post", "/api/v1/library/scores/batch-move", {"score_ids": ["score-1"]}),
        (
            "post",
            "/api/v1/library/scores/batch-favorite",
            {"score_ids": ["score-1"], "is_favorite": True},
        ),
    ]

    for method, path, payload in protected_requests:
        response = _request(client, method, path, payload)
        assert response.status_code == 401, f"{method.upper()} {path}"


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
        assert missing_header_payload["code"] == "csrf_token_invalid"
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
            headers={"host": "localhost:8000", "origin": "http://localhost:3000"},
        )
        assert response.status_code == 401
    finally:
        client.cookies.delete(settings.REFRESH_COOKIE_NAME)


def test_cors_origin_header_is_emitted_for_configured_frontend(client: TestClient) -> None:
    response = client.get(
        "/api/v1/me/profile",
        headers={"origin": "http://localhost:3000"},
    )

    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
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
        assert payload["code"] == "request_origin_invalid"
        assert payload["request_id"] == "origin-contract"
        assert response.headers["X-Request-ID"] == "origin-contract"
    finally:
        client.cookies.delete(settings.REFRESH_COOKIE_NAME)


def test_origin_normalization_collapses_default_ports() -> None:
    assert (
        normalize_origin("https://staging.johnabc.ccwu.cc:443") == "https://staging.johnabc.ccwu.cc"
    )
    assert normalize_origin("http://localhost:80") == "http://localhost"
    assert normalize_origin("http://localhost:3000") == "http://localhost:3000"
    assert normalize_origin("not-a-url") is None


def test_cookie_authenticated_writes_allow_configured_origin_with_default_port(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BACKEND_CORS_ORIGINS", ["https://staging.johnabc.ccwu.cc"])
    client.cookies.set(settings.REFRESH_COOKIE_NAME, "invalid-refresh-token")
    client.cookies.set(settings.CSRF_COOKIE_NAME, "csrf-token")

    try:
        response = client.put(
            "/api/v1/me/profile",
            json={"display_name": "New Name"},
            headers={
                "origin": "https://staging.johnabc.ccwu.cc:443",
                settings.CSRF_HEADER_NAME: "csrf-token",
            },
        )
        assert response.status_code == 401
    finally:
        client.cookies.delete(settings.REFRESH_COOKIE_NAME)
        client.cookies.delete(settings.CSRF_COOKIE_NAME)


def test_login_requires_request_body(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", headers={"X-Request-ID": "validation-contract"})
    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "validation_error"
    assert payload["request_id"] == "validation-contract"
    assert response.headers["X-Request-ID"] == "validation-contract"
