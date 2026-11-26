"""Hash-only bearer credentials and current-head presentation boundaries."""

from app.composition import storage_resources as _resource_wiring

from app.shared.time import utc_now
from app.core.generated.customer_browser_protocol import AUTH_COOKIE_NAME

import pytest
from sqlalchemy import select
from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import (
    Score,
    StoredObject,
    ScoreRevision,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    ScoreLibraryOrganization,
    ScoreMembership,
)
from app.modules.playback.domain import PlaybackAssetKind
from app.modules.revisions.domain import RevisionOrigin
from app.modules.score_assets.domain import RenderAssetKind
from app.db.models.score_access import MembershipRole
from app.db.models import GuestPreviewCredential
from app.modules.guest_previews.credentials import (
    guest_preview_token_hash,
    issue_guest_preview_token,
)
from app.core.exceptions import ConflictException
from app.modules.guest_previews.service import GuestPreviewService
from tests.test_score_revision_services import (
    add_active_score_with_head_revision,
    score_service_session as score_service_session,
)


@pytest.fixture
def preview_context(score_service_session):
    session, storage = score_service_session
    score = add_active_score_with_head_revision(
        session,
        score_id=900,
        revision_id=901,
        score_uuid="preview-score",
        revision_uuid="revision-a",
        title="Preview score",
    )
    return (
        session,
        storage,
        score,
        session,
        GuestPreviewService(delivery=_resource_wiring.build_media_delivery_service(storage)),
    )


def add_page(session, storage, revision_id, asset_id, *, render_profile="default"):
    stored = storage.put_bytes(
        key=f"preview/{asset_id}.svg",
        content=b'<svg xmlns="http://www.w3.org/2000/svg"/>',
        content_type="image/svg+xml",
    )
    asset = ScoreRenderAsset(
        asset_uuid=asset_id,
        revision_id=revision_id,
        kind=RenderAssetKind.RENDERED_PAGE,
        stored_object=StoredObject(
            object_key=stored.object_key,
            content_type="image/svg+xml",
            byte_size=stored.size_bytes,
            sha256="a" * 64,
        ),
        filename=stored.object_key.rsplit("/", 1)[-1],
        page_number=1,
        render_profile=render_profile,
        generator="test",
        generator_version="1",
    )
    session.add(asset)
    session.commit()
    return asset


def add_audio(session, storage, revision_id):
    stored = storage.put_bytes(
        key=f"preview/{revision_id}.wav", content=b"RIFF....WAVE", content_type="audio/wav"
    )
    session.add(
        ScorePlaybackAsset(
            asset_uuid=f"audio-{revision_id}",
            revision_id=revision_id,
            kind=PlaybackAssetKind.AUDIO,
            stored_object=StoredObject(
                object_key=stored.object_key,
                content_type="audio/wav",
                byte_size=stored.size_bytes,
                sha256="b" * 64,
            ),
            filename=stored.object_key.rsplit("/", 1)[-1],
            duration_ms=1000,
            source_fingerprint="c" * 64,
            generator="test",
            generator_version="1",
        )
    )
    session.commit()


def add_head_b(session, score):
    session.add(
        ScoreRevision(
            id=902,
            revision_uuid="revision-b",
            score_id=score.id,
            revision_number=2,
            content_hash="b" * 64,
            origin=RevisionOrigin.EDIT,
        )
    )
    session.commit()
    score.head_revision_id = 902
    session.add(score)
    session.commit()


def test_credential_lifecycle_is_hash_only_and_does_not_change_score(preview_context):
    db, _, score, _, service = preview_context
    before = (score.metadata_version, score.updated_at, score.head_revision_id)
    assert service.settings(db, score.score_uuid, 1).model_dump() == {
        "enabled": False,
        "issued_at": None,
    }
    with pytest.raises(ConflictException) as error:
        service.rotate_credential(db, score.score_uuid, 1)
    assert error.value.code == "guest_preview_not_enabled"
    a = service.issue_credential(db, score.score_uuid, 1)
    credential = db.scalar(select(GuestPreviewCredential))
    assert credential.token_hash == guest_preview_token_hash(a.token) != a.token
    assert set(credential.model_dump()) == {"id", "score_id", "token_hash", "issued_at"}
    assert service.read(db, a.token).display_title == score.display_title
    settings = service.settings(db, score.score_uuid, 1)
    assert settings.enabled and settings.issued_at is not None
    assert set(settings.model_dump()) == {"enabled", "issued_at"}
    with pytest.raises(ConflictException) as error:
        service.issue_credential(db, score.score_uuid, 1)
    assert error.value.code == "guest_preview_already_enabled"
    service.revoke_credential(db, score.score_uuid, 1)
    service.revoke_credential(db, score.score_uuid, 1)
    assert db.scalar(select(GuestPreviewCredential)) is None
    b = service.issue_credential(db, score.score_uuid, 1)
    assert a.token != b.token
    assert service.read(db, b.token)
    with pytest.raises(ResourceNotFoundException):
        service.read(db, a.token)
    c = service.rotate_credential(db, score.score_uuid, 1)
    assert c.token not in {a.token, b.token}
    assert service.read(db, c.token)
    for token in [a.token, b.token, "unknown", "." * 43, "x" * 43]:
        with pytest.raises(ResourceNotFoundException) as error:
            service.read(db, token)
        assert error.value.code == "guest_preview_not_found"
    db.refresh(score)
    assert (score.metadata_version, score.updated_at, score.head_revision_id) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("role", list(MembershipRole))
async def test_only_owner_can_manage_credentials_and_read_settings(preview_context, role):
    session, _, score, db, service = preview_context
    session.add(ScoreMembership(score_id=score.id, user_id=2, role=role, created_by_user_id=1))
    session.commit()
    for action in [
        lambda: service.settings(db, score.score_uuid, 2),
        lambda: service.issue_credential(db, score.score_uuid, 2),
        lambda: service.rotate_credential(db, score.score_uuid, 2),
        lambda: service.revoke_credential(db, score.score_uuid, 2),
    ]:
        with pytest.raises(UnauthorizedException):
            action()


def test_bearer_follows_head_and_never_falls_back(preview_context):
    session, storage, score, db, service = preview_context
    add_page(session, storage, 901, "page-a")
    add_audio(session, storage, 901)
    enabled = service.issue_credential(db, score.score_uuid, 1)
    first = service.read(db, enabled.token)
    assert [p.asset_id for p in first.render_assets] == ["page-a"] and first.audio_available
    add_head_b(session, score)
    waiting = service.read(db, enabled.token)
    assert waiting.render_assets == [] and not waiting.audio_available
    with pytest.raises(ResourceNotFoundException):
        service.image(db, enabled.token, "page-a")
    with pytest.raises(ResourceNotFoundException):
        service.audio(db, enabled.token)
    add_page(session, storage, 902, "page-b")
    add_audio(session, storage, 902)
    latest = service.read(db, enabled.token)
    assert [p.asset_id for p in latest.render_assets] == ["page-b"] and latest.audio_available
    assert (service.image(db, enabled.token, "page-b")).storage_key.endswith("page-b.svg")
    assert (service.audio(db, enabled.token)).storage_key.endswith("902.wav")
    assert set(latest.model_dump()) == {
        "display_title",
        "shared_by",
        "render_assets",
        "audio_available",
    }
    assert latest.shared_by == "owner"


def test_deleted_and_headless_scores_are_unavailable(preview_context):
    db, _, score, _, service = preview_context
    token = service.issue_credential(db, score.score_uuid, 1).token
    score.head_revision_id = None
    db.commit()
    with pytest.raises(ResourceNotFoundException):
        service.read(db, token)
    score.head_revision_id = 901
    score.deleted_at = utc_now()
    db.commit()
    with pytest.raises(ResourceNotFoundException) as error:
        service.read(db, token)
    assert error.value.code == "guest_preview_not_found"


def test_presentation_isolates_the_canonical_profile(preview_context):
    db, storage, score, _, service = preview_context
    add_page(db, storage, 901, "canonical")
    add_page(db, storage, 901, "alternate", render_profile="profile-b")
    db.commit()
    token = service.issue_credential(db, score.score_uuid, 1).token
    assert [page.asset_id for page in service.read(db, token).render_assets] == ["canonical"]
    with pytest.raises(ResourceNotFoundException) as error:
        service.image(db, token, "alternate")
    assert error.value.code == "file_not_found"


def test_preview_token_redaction(preview_context):
    from app.core.logger import SensitiveDataFilter

    _, _, score, _, _ = preview_context
    token = issue_guest_preview_token()
    path = f"/api/v1/guest-previews/{token}/render-assets/a/view"
    assert token not in SensitiveDataFilter.filter_string(path)
    for value in [
        {"token": token},
        {"error_details": {"token": token}},
        {"http_path": path},
        {"message": repr(score)},
    ]:
        assert token not in str(SensitiveDataFilter.filter_dict(value))
    assert token not in SensitiveDataFilter.filter_string(f"token='{token}'")


@pytest.mark.asyncio
async def test_bearer_routes_are_anonymous_inline_private_and_disclosure_safe(preview_context):
    from httpx import AsyncClient, ASGITransport
    from app.api.deps import get_db, get_current_user, get_optional_current_user
    from app.main import app
    from app.api.resource_dependencies import get_guest_preview_service

    session, storage, score, db, service = preview_context
    add_page(session, storage, 901, "page-a")
    add_audio(session, storage, 901)
    token = service.issue_credential(db, score.score_uuid, 1).token

    def database():
        yield db

    def no_account_authorization():
        raise AssertionError("Guest Preview must not resolve ambient account authority")

    app.dependency_overrides[get_current_user] = no_account_authorization
    app.dependency_overrides[get_optional_current_user] = no_account_authorization
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_guest_preview_service] = lambda: service
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    try:
        for cookies in [{}, {AUTH_COOKIE_NAME: "ambient-invalid-login"}]:
            client.cookies.update(cookies)
            response = await client.get(f"/api/v1/guest-previews/{token}")
            assert response.status_code == 200
            assert response.headers["cache-control"] == "private, no-store"
            assert set(response.json()) == {
                "display_title",
                "shared_by",
                "render_assets",
                "audio_available",
            }
            assert response.json()["render_assets"] == [{"asset_id": "page-a", "page_number": 1}]
            image = await client.get(f"/api/v1/guest-previews/{token}/render-assets/page-a/view")
            assert image.status_code == 200 and image.headers["content-disposition"].startswith(
                "inline"
            )
            assert image.headers["cache-control"] == "private, no-store"
            audio = await client.get(
                f"/api/v1/guest-previews/{token}/playback", headers={"Range": "bytes=0-3"}
            )
            assert audio.status_code == 206 and audio.content == b"RIFF"
            assert audio.headers["cache-control"] == "private, no-store"
        assert session.execute(select(ScoreLibraryOrganization)).all() == []
        assert session.execute(select(ScoreMembership)).all() == []
    finally:
        await client.aclose()
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_optional_current_user, None)
        app.dependency_overrides.pop(get_guest_preview_service, None)


@pytest.mark.asyncio
async def test_owner_settings_http_state_and_authorization(preview_context):
    from httpx import AsyncClient, ASGITransport
    from app.api.deps import get_db, get_current_user
    from app.db.models import User
    from app.main import app
    from app.api.resource_dependencies import get_guest_preview_service

    session, _, score, db, service = preview_context
    user = session.get(User, 1)

    def database():
        yield db

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_guest_preview_service] = lambda: service
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            url = f"/api/v1/scores/{score.score_uuid}/guest-preview"
            response = await client.get(url)
            assert response.status_code == 200
            assert response.headers["cache-control"] == "private, no-store"
            assert response.json() == {"enabled": False, "issued_at": None}
            credential_url = url + "/credential"
            revealed_tokens = []
            for method, target, expected in [
                (client.post, credential_url, 200),
                (client.post, credential_url, 409),
                (client.post, credential_url + "/rotate", 200),
                (client.delete, credential_url, 204),
                (client.delete, credential_url, 204),
                (client.post, credential_url + "/rotate", 409),
            ]:
                response = await method(target)
                assert response.status_code == expected
                assert response.headers["cache-control"] == "private, no-store"
                if expected == 200:
                    revealed_tokens.append(response.json()["token"])
                for secret in revealed_tokens:
                    assert secret not in str(response.headers)
                    if expected != 200:
                        assert secret not in response.text
                settings = await client.get(url)
                assert set(settings.json()) == {"enabled", "issued_at"}
                assert all(secret not in settings.text for secret in revealed_tokens)
            user = session.get(User, 2)
            for method, target in [
                (client.get, url),
                (client.post, credential_url),
                (client.post, credential_url + "/rotate"),
                (client.delete, credential_url),
            ]:
                response = await method(target)
                assert response.status_code in {403, 404}
                assert response.headers["cache-control"] == "private, no-store"
                assert all(secret not in response.text for secret in revealed_tokens)
    finally:
        for dependency in [get_db, get_current_user, get_guest_preview_service]:
            app.dependency_overrides.pop(dependency, None)


@pytest.fixture
def preview_http_app(preview_context):
    from app.api.deps import get_db
    from app.main import create_app
    from app.api.resource_dependencies import get_guest_preview_service

    _, _, _, db, service = preview_context
    application = create_app()

    def database():
        yield db

    application.dependency_overrides[get_db] = database
    application.dependency_overrides[get_guest_preview_service] = lambda: service
    return application


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["disabled", "unknown", "deleted"])
@pytest.mark.parametrize("suffix", ["", "/render-assets/page-a/view", "/playback"])
async def test_unavailable_bearer_responses_are_not_cacheable(
    preview_context, preview_http_app, state, suffix
):
    from httpx import AsyncClient, ASGITransport

    session, _, score, db, service = preview_context
    token = service.issue_credential(db, score.score_uuid, 1).token
    if state == "disabled":
        service.revoke_credential(db, score.score_uuid, 1)
    if state == "unknown":
        token = "unknown-token"
    elif state == "deleted":
        score.deleted_at = utc_now()
    session.commit()
    async with AsyncClient(
        transport=ASGITransport(app=preview_http_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/guest-previews/{token}{suffix}")
    assert response.status_code == 404
    assert response.json()["code"] == "guest_preview_not_found"
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.asyncio
async def test_current_head_delivery_failures_are_not_cacheable(preview_context, preview_http_app):
    from httpx import AsyncClient, ASGITransport

    session, storage, score, db, service = preview_context
    add_page(session, storage, 901, "page-a")
    add_audio(session, storage, 901)
    token = service.issue_credential(db, score.score_uuid, 1).token
    add_head_b(session, score)
    async with AsyncClient(
        transport=ASGITransport(app=preview_http_app), base_url="http://test"
    ) as client:
        for suffix in ["/render-assets/page-a/view", "/playback"]:
            response = await client.get(f"/api/v1/guest-previews/{token}{suffix}")
            assert response.status_code == 404
            assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation,suffix",
    [("read", ""), ("image", "/render-assets/page-a/view"), ("audio", "/playback")],
)
async def test_unhandled_bearer_errors_are_not_cacheable(
    preview_context, preview_http_app, monkeypatch, operation, suffix
):
    from httpx import AsyncClient, ASGITransport

    _, _, score, _, service = preview_context

    def unavailable(*args):
        raise RuntimeError("Presentation service unavailable")

    monkeypatch.setattr(service, operation, unavailable)
    async with AsyncClient(
        transport=ASGITransport(app=preview_http_app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        response = await client.get(f"/api/v1/guest-previews/{issue_guest_preview_token()}{suffix}")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.asyncio
async def test_bearer_dependency_validation_response_is_not_cacheable(
    preview_context, preview_http_app
):
    from httpx import AsyncClient, ASGITransport
    from app.api.resource_dependencies import get_guest_preview_service

    _, _, score, _, service = preview_context

    def validated_service(required_number: int):
        return service

    preview_http_app.dependency_overrides[get_guest_preview_service] = validated_service
    async with AsyncClient(
        transport=ASGITransport(app=preview_http_app), base_url="http://test"
    ) as client:
        response = await client.get(
            f"/api/v1/guest-previews/{issue_guest_preview_token()}?required_number=invalid"
        )
    assert response.status_code == 422
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.asyncio
async def test_owner_settings_errors_share_policy_without_affecting_other_routes(preview_http_app):
    from httpx import AsyncClient, ASGITransport
    from starlette.responses import Response
    from app.api.deps import get_current_user
    from app.db.models import User

    @preview_http_app.get("/api/v1/cache-policy-control")
    def cacheable_control():
        return Response(headers={"Cache-Control": "public, max-age=60"})

    async with AsyncClient(
        transport=ASGITransport(app=preview_http_app), base_url="http://test"
    ) as client:
        for method, suffix in [
            (client.get, ""),
            (client.post, "/credential"),
            (client.delete, "/credential"),
            (client.post, "/credential/rotate"),
        ]:
            response = await method("/api/v1/scores/preview-score/guest-preview" + suffix)
            assert response.status_code == 401
            assert response.headers["cache-control"] == "private, no-store"
        preview_http_app.dependency_overrides[get_current_user] = lambda: User(id=1)
        response = await client.post("/api/v1/scores/missing/guest-preview/credential/rotate")
        assert response.status_code == 404
        assert response.headers["cache-control"] == "private, no-store"
        response = await client.get("/api/v1/cache-policy-control")
        assert response.headers["cache-control"] == "public, max-age=60"


@pytest.mark.asyncio
async def test_alternate_profile_image_is_unavailable_over_http(preview_context, preview_http_app):
    from httpx import AsyncClient, ASGITransport

    db, storage, score, _, service = preview_context
    add_page(db, storage, 901, "canonical")
    add_page(db, storage, 901, "alternate", render_profile="profile-b")
    token = service.issue_credential(db, score.score_uuid, 1).token
    async with AsyncClient(
        transport=ASGITransport(app=preview_http_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/guest-previews/{token}")
        assert response.json()["render_assets"] == [{"asset_id": "canonical", "page_number": 1}]
        response = await client.get(f"/api/v1/guest-previews/{token}/render-assets/alternate/view")
        assert response.status_code == 404 and response.json()["code"] == "file_not_found"
        assert response.headers["cache-control"] == "private, no-store"


def test_credential_security_schema_and_owner_command_boundary():
    from app.modules.guest_previews.router import score_router
    from app.modules.guest_previews.schemas import (
        GuestPreviewSettingsRead,
        GuestPreviewCredentialIssuedRead,
    )

    assert set(GuestPreviewCredential.model_fields) == {"id", "score_id", "token_hash", "issued_at"}
    assert not {"guest_preview_token", "guest_preview_enabled"} & Score.model_fields.keys()
    assert set(GuestPreviewSettingsRead.model_fields) == {"enabled", "issued_at"}
    assert set(GuestPreviewCredentialIssuedRead.model_fields) == {"token", "issued_at"}
    assert {(method, route.path) for route in score_router.routes for method in route.methods} == {
        ("GET", "/{score_id}/guest-preview"),
        ("POST", "/{score_id}/guest-preview/credential"),
        ("DELETE", "/{score_id}/guest-preview/credential"),
        ("POST", "/{score_id}/guest-preview/credential/rotate"),
    }


def test_bearer_secrets_are_removed_from_production_log_output():
    from app.core.logger import json_format

    token = issue_guest_preview_token()
    payload = json_format(
        {
            "time": utc_now(),
            "level": type("Level", (), {"name": "INFO"})(),
            "name": "test",
            "message": f"GET /api/v1/guest-previews/{token}/playback token={token}",
            "function": "test",
            "line": 1,
            "extra": {"token": token, "token_hash": guest_preview_token_hash(token)},
            "exception": None,
        }
    )
    assert token not in payload
    assert guest_preview_token_hash(token) not in payload


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "method,suffix,operation",
    [
        ("GET", "", "settings"),
        ("POST", "/credential", "issue_credential"),
        ("DELETE", "/credential", "revoke_credential"),
        ("POST", "/credential/rotate", "rotate_credential"),
    ],
)
async def test_owner_command_failure_responses_are_private(
    preview_context, preview_http_app, monkeypatch, method, suffix, operation
):
    from httpx import AsyncClient, ASGITransport
    from app.api.deps import get_current_user
    from app.db.models import User

    db, _, _, _, service = preview_context
    secret = issue_guest_preview_token()

    def failed(*args):
        raise RuntimeError("token=" + secret)

    monkeypatch.setattr(service, operation, failed)
    preview_http_app.dependency_overrides[get_current_user] = lambda: db.get(User, 1)
    async with AsyncClient(
        transport=ASGITransport(app=preview_http_app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        response = await client.request(
            method, "/api/v1/scores/preview-score/guest-preview" + suffix
        )
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert response.headers["cache-control"] == "private, no-store"
    assert secret not in response.text and secret not in str(response.headers)
