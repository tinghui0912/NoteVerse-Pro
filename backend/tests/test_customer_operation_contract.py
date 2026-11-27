"""Consumer operations have explicit semantic identities and truthful success bodies."""

from app.composition import storage_resources as _resource_wiring

from app.modules.media_storage.reads import StoredObjectDelivery

from app.storage import AsyncObjectReader
import fnmatch
import io
import re
import zipfile
from types import SimpleNamespace
from unittest.mock import Mock
from pydantic import TypeAdapter

import pytest
from fastapi.routing import APIRoute, iter_route_contexts

from app.api.deps import get_current_user, get_db
from app.api.runtime_schemas import RootRead, LivenessRead, ReadinessRead
from app.main import app
from app.modules.auth.dependencies import get_password_reset_service
from app.api.resource_dependencies import get_avatar_service
from app.api.resource_dependencies import get_guest_preview_service
from app.api.resource_dependencies import get_import_job_service
from app.api.resource_dependencies import get_score_asset_service
from app.api.resource_dependencies import get_score_service
from tests.support.object_storage import InMemoryObjectStorage


def operations(spec):
    return {
        operation["operationId"]: operation
        for path in spec["paths"].values()
        for method, operation in path.items()
        if method in {"get", "post", "put", "patch", "delete", "head", "options"}
    }


def test_every_customer_operation_has_an_explicit_unique_semantic_identity(client):
    schema = client.get("/api/v1/openapi.json").json()
    declared = []
    for context in iter_route_contexts(app.routes):
        if not isinstance(context.original_route, APIRoute) or not context.include_in_schema:
            continue
        identity = context.operation_id
        assert identity is not None, context.path
        assert re.fullmatch(r"[a-z][A-Za-z0-9]*", identity), identity
        assert "apiV1" not in identity and "ApiV1" not in identity
        for method in context.methods:
            assert schema["paths"][context.path_format][method.lower()]["operationId"] == identity
            declared.append(identity)
    assert len(declared) == len(set(declared))
    assert set(declared) == set(operations(schema))


def test_every_success_body_has_a_concrete_schema_and_media_contract(client):
    spec = client.get("/api/v1/openapi.json").json()
    for identity, operation in operations(spec).items():
        successes = {
            code: response
            for code, response in operation["responses"].items()
            if code.startswith("2")
        }
        if not successes:
            # Image resolution intentionally issues a bodyless capability redirect.
            response = operation["responses"]["307"]
            assert operation["operationId"] == "accountAvatarResolve"
            assert response["headers"]["Location"]["schema"]["format"] == "uri"
            assert not response.get("content")
        for code, response in successes.items():
            if code in {"204", "205"}:
                assert not response.get("content")
                continue
            assert response.get("content"), (identity, code)
            for media_type, media in response["content"].items():
                schema = media.get("schema")
                assert schema and any(k in schema for k in ("$ref", "type", "oneOf", "anyOf")), (
                    identity,
                    code,
                )
                if media_type == "application/json":
                    assert "$ref" in schema or schema.get("type") in {"object", "array"}, identity
                elif media_type == "text/event-stream":
                    assert schema == {"type": "string"}
                else:
                    assert schema == {"type": "string", "format": "binary"}


def test_process_json_success_matches_named_schemas(client, monkeypatch):
    async def available():
        return True

    monkeypatch.setattr("app.api.health.check_database_readiness", available)
    monkeypatch.setattr("app.api.health.check_storage_quota_policy_readiness", available)
    monkeypatch.setattr("app.api.health.check_redis_readiness", available)
    spec = operations(client.get("/api/v1/openapi.json").json())
    for path, identity, model in [
        ("/", "serviceInfoGet", RootRead),
        ("/health/live", "healthLive", LivenessRead),
        ("/health/ready", "healthReady", ReadinessRead),
    ]:
        response = client.get(path)
        assert response.status_code == 200
        assert TypeAdapter(model).validate_python(response.json()) == response.json()
        assert spec[identity]["responses"]["200"]["content"]["application/json"]["schema"] == {
            "$ref": f"#/components/schemas/{model.__name__}"
        }


# Exercise actual route handlers and storage streaming, including resource-dependent MIME.
@pytest.mark.parametrize(
    "path,identity,dependency,method,mime,range_enabled",
    [
        (
            "/guest-previews/token/render-assets/page/view",
            "guestPreviewPageView",
            get_guest_preview_service,
            "image",
            "image/svg+xml",
            False,
        ),
        (
            "/import-jobs/job/artifacts/artifact/download",
            "importJobArtifactDownload",
            get_import_job_service,
            "artifact_delivery",
            "application/json",
            False,
        ),
        (
            "/import-jobs/job/artifacts/upload:1/download",
            "importJobArtifactDownload",
            get_import_job_service,
            "artifact_delivery",
            "application/pdf",
            False,
        ),
        (
            "/render-assets/page/download",
            "scoreRenderAssetDownload",
            get_score_asset_service,
            "render_asset_delivery",
            "image/svg+xml",
            False,
        ),
        (
            "/render-assets/page/view",
            "scoreRenderAssetView",
            get_score_asset_service,
            "render_asset_delivery",
            "image/png",
            False,
        ),
        (
            "/revision-sources/source/download",
            "scoreRevisionSourceDownload",
            get_score_asset_service,
            "source_delivery",
            "application/vnd.recordare.musicxml+xml",
            False,
        ),
        (
            "/scores/score/input-assets/input/download",
            "scoreInputAssetDownload",
            get_score_service,
            "input_asset_delivery",
            "image/jpeg",
            False,
        ),
    ],
)
def test_storage_route_success_matches_its_declared_binary_content(
    client, path, identity, dependency, method, mime, range_enabled
):
    storage = InMemoryObjectStorage()
    content = b"actual stored resource bytes"
    storage.put_bytes(key="object", content=content, content_type=mime)
    delivery = StoredObjectDelivery(1, "object", len(content), mime, "resource")
    result = delivery
    service = SimpleNamespace(
        storage=storage,
        delivery=_resource_wiring.build_media_delivery_service(storage),
        async_storage=AsyncObjectReader(storage),
        **{method: Mock(return_value=result)},
    )

    def database():
        yield object()

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    app.dependency_overrides[dependency] = lambda: service
    try:
        response = client.get("/api/v1" + path)
        assert response.status_code == 200 and response.content == content
        actual_type = response.headers["content-type"].split(";")[0]
        assert actual_type == mime
        operation = operations(client.get("/api/v1/openapi.json").json())[identity]
        declared = operation["responses"]["200"]["content"]
        assert any(fnmatch.fnmatchcase(actual_type, pattern) for pattern in declared)
        for media in declared.values():
            assert media["schema"] == {"type": "string", "format": "binary"}
        if range_enabled:
            partial = client.get("/api/v1" + path, headers={"Range": "bytes=2-7"})
            assert partial.status_code == 206 and partial.content == content[2:8]
            assert partial.headers["content-range"] == f"bytes 2-7/{len(content)}"
            assert operation["responses"]["206"]["content"] == declared
    finally:
        for dep in (get_db, get_current_user, dependency):
            app.dependency_overrides.pop(dep, None)


def test_render_archive_success_is_zip_not_json(client):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zipped:
        zipped.writestr("page.svg", "<svg/>")
    content = archive.getvalue()
    service = SimpleNamespace(
        render_asset_archive=Mock(return_value=(io.BytesIO(content), "pages.zip"))
    )

    def database():
        yield object()

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    app.dependency_overrides[get_score_asset_service] = lambda: service
    try:
        response = client.get(
            "/api/v1/scores/score/render-asset-archive?kind=RENDERED_PAGE&render_profile=default"
        )
        assert response.status_code == 200 and response.content == content
        assert response.headers["content-type"] == "application/zip"
        contract = operations(client.get("/api/v1/openapi.json").json())["scoreRenderAssetsArchive"]
        assert set(contract["responses"]["200"]["content"]) == {"application/zip"}
    finally:
        for dep in (get_db, get_current_user, get_score_asset_service):
            app.dependency_overrides.pop(dep, None)


def test_realtime_success_is_an_event_stream(client, monkeypatch):
    def events(*args):
        yield ": connected\n\n"
        yield 'id: 1\nevent: change\ndata: {"schemaVersion":1,"sequence":1,"changeId":"change","kind":"notifications.changed","notificationId":null,"createdAt":"2026-11-15T00:00:00Z"}\n\n'

    monkeypatch.setattr("app.modules.realtime.router._event_stream", events)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    try:
        response = client.get("/api/v1/realtime/events")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert "event: change" in response.text
        assert '"kind":"notifications.changed"' in response.text
        contract = operations(client.get("/api/v1/openapi.json").json())["realtimeEventsStream"]
        assert contract["responses"]["200"]["content"] == {
            "text/event-stream": {"schema": {"type": "string"}}
        }
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_password_reset_completes_without_a_representation(client):
    service = SimpleNamespace(reset_password=Mock())

    def database():
        yield object()

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_password_reset_service] = lambda: service
    try:
        response = client.post(
            "/api/v1/auth/password/reset", json={"token": "token", "new_password": "new-password"}
        )
        assert response.status_code == 204
        assert response.content == b""
        operation = operations(client.get("/api/v1/openapi.json").json())["authPasswordReset"]
        assert "content" not in operation["responses"]["204"]
    finally:
        for dep in (get_db, get_password_reset_service):
            app.dependency_overrides.pop(dep, None)


def test_avatar_resolution_is_a_bodyless_redirect_with_location(client):
    filename = "1_" + "a" * 64 + "_" + "b" * 32 + ".jpg"
    target = "https://objects.example/avatar.jpg?signature=capability"
    service = SimpleNamespace(
        avatar_exists=Mock(return_value=True),
        storage=SimpleNamespace(download_url=Mock(return_value=target)),
        delivery=_resource_wiring.build_media_delivery_service(
            SimpleNamespace(download_url=Mock(return_value=target))
        ),
    )

    def database():
        yield SimpleNamespace(
            scalar=Mock(
                return_value=SimpleNamespace(
                    id=1, object_key="avatar", byte_size=1, content_type="image/jpeg"
                )
            )
        )

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_avatar_service] = lambda: service
    try:
        response = client.get(f"/api/v1/me/avatars/{filename}", follow_redirects=False)
        assert response.status_code == 307 and response.content == b""
        assert response.headers["location"] == target
        contract = operations(client.get("/api/v1/openapi.json").json())["accountAvatarResolve"]
        assert "Location" in contract["responses"]["307"]["headers"]
        assert not contract["responses"]["307"].get("content")
    finally:
        for dep in (get_db, get_avatar_service):
            app.dependency_overrides.pop(dep, None)


def test_render_archive_requires_an_explicit_profile(client):
    def database():
        yield object()

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    try:
        response = client.get("/api/v1/scores/score/render-asset-archive?kind=RENDERED_PAGE")
        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"
    finally:
        for dep in (get_db, get_current_user):
            app.dependency_overrides.pop(dep, None)
