"""Stable Score bearer settings and current-head presentation boundaries."""

from app.utils.timezone import utc_now_naive

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import (
    Score,
    StoredObject,
    ScoreRevision,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    PlaybackAssetKind,
    ScoreLibraryOrganization,
    ScoreMembership,
)
from app.db.models.score import RevisionOrigin, RenderAssetKind
from app.db.models.score_access import MembershipRole
from app.modules.guest_previews.schemas import GuestPreviewUpdateRequest
from app.modules.guest_previews.service import GuestPreviewService
from tests.test_score_revision_services import (
    AsyncSessionAdapter,
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
        AsyncSessionAdapter(session),
        GuestPreviewService(storage=storage),
    )


def add_page(session, storage, revision_id, asset_id):
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
        render_profile="default",
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


@pytest.mark.asyncio
async def test_owner_settings_token_stability_and_generic_disclosure(preview_context):
    session, _, score, db, service = preview_context
    token = score.guest_preview_token
    assert len(token) >= 43
    assert not score.guest_preview_enabled
    assert (await service.settings(db, score.score_uuid, 1)).model_dump() == {
        "enabled": False,
        "token": token,
    }
    for enabled in [True, False, True]:
        result = await service.update_settings(
            db, score.score_uuid, 1, GuestPreviewUpdateRequest(enabled=enabled)
        )
        assert result.token == token and result.enabled == enabled
    from app.modules.scores.service import ScoreService
    from app.modules.scores.schemas import ScoreUpdateRequest

    await ScoreService().update(
        db,
        score.score_uuid,
        1,
        ScoreUpdateRequest(expected_version=score.version, title="Updated", genres=["jazz"]),
    )
    add_head_b(session, score)
    assert (await service.settings(db, score.score_uuid, 1)).token == token
    assert token not in repr(score)
    assert "guest_preview_token" not in score.model_dump()
    assert "guest_preview_token" not in dict(score)
    read = await ScoreService().get(db, score.score_uuid, 1)
    assert token not in read.model_dump_json()
    other = Score(score_uuid="distinct", owner_user_id=1, title="Other")
    session.add(other)
    session.commit()
    assert other.guest_preview_token != token and len(other.guest_preview_token) >= 43


@pytest.mark.asyncio
@pytest.mark.parametrize("role", list(MembershipRole))
async def test_only_owner_can_read_or_update_settings(preview_context, role):
    session, _, score, db, service = preview_context
    session.add(ScoreMembership(score_id=score.id, user_id=2, role=role, created_by_user_id=1))
    session.commit()
    for action in [
        service.settings(db, score.score_uuid, 2),
        service.update_settings(db, score.score_uuid, 2, GuestPreviewUpdateRequest(enabled=True)),
    ]:
        with pytest.raises(UnauthorizedException):
            await action


@pytest.mark.asyncio
async def test_bearer_follows_head_and_never_falls_back(preview_context):
    session, storage, score, db, service = preview_context
    add_page(session, storage, 901, "page-a")
    add_audio(session, storage, 901)
    enabled = await service.update_settings(
        db, score.score_uuid, 1, GuestPreviewUpdateRequest(enabled=True)
    )
    first = await service.read(db, enabled.token)
    assert [p.asset_id for p in first.render_assets] == ["page-a"] and first.audio_available
    add_head_b(session, score)
    waiting = await service.read(db, enabled.token)
    assert waiting.render_assets == [] and not waiting.audio_available
    with pytest.raises(ResourceNotFoundException):
        await service.image(db, enabled.token, "page-a")
    with pytest.raises(ResourceNotFoundException):
        await service.audio(db, enabled.token)
    add_page(session, storage, 902, "page-b")
    add_audio(session, storage, 902)
    latest = await service.read(db, enabled.token)
    assert [p.asset_id for p in latest.render_assets] == ["page-b"] and latest.audio_available
    assert (await service.image(db, enabled.token, "page-b")).storage_key.endswith("page-b.svg")
    assert (await service.audio(db, enabled.token)).storage_key.endswith("902.wav")
    assert set(latest.model_dump()) == {"title", "shared_by", "render_assets", "audio_available"}
    assert latest.shared_by == "owner"


@pytest.mark.asyncio
async def test_disabled_missing_and_deleted_are_unavailable(preview_context):
    session, _, score, db, service = preview_context
    token = score.guest_preview_token
    for enabled in [False, True, False, True]:
        await service.update_settings(
            db, score.score_uuid, 1, GuestPreviewUpdateRequest(enabled=enabled)
        )
        for action in [service.read, service.audio]:
            if enabled and action == service.read:
                assert (await action(db, token)).title == score.title
            elif not enabled:
                with pytest.raises(ResourceNotFoundException) as error:
                    await action(db, token)
                assert error.value.code == "guest_preview_not_found"
    score.deleted_at = utc_now_naive()
    session.commit()
    for secret in [token, "missing"]:
        with pytest.raises(ResourceNotFoundException) as error:
            await service.read(db, secret)
        assert error.value.code == "guest_preview_not_found"


@pytest.mark.parametrize(
    "values", [{}, {"enabled": True, "allow_download": True}, {"enabled": True, "revision_id": 1}]
)
def test_settings_request_admits_only_enabled_state(values):
    with pytest.raises(ValidationError):
        GuestPreviewUpdateRequest.model_validate(values)


def test_preview_token_redaction(preview_context):
    from app.core.logger import SensitiveDataFilter

    _, _, score, _, _ = preview_context
    token = score.guest_preview_token
    path = f"/api/v1/guest-previews/{token}/render-assets/a/view"
    assert token not in SensitiveDataFilter.filter_string(path)
    for value in [
        {"guest_preview_token": token},
        {"error_details": {"guest_preview_token": token}},
        {"http_path": path},
        {"message": repr(score)},
    ]:
        assert token not in str(SensitiveDataFilter.filter_dict(value))
    assert token not in SensitiveDataFilter.filter_string(f"guest_preview_token='{token}'")


@pytest.mark.asyncio
async def test_bearer_routes_are_anonymous_inline_private_and_disclosure_safe(preview_context):
    from httpx import AsyncClient, ASGITransport
    from app.api.deps import get_db, get_current_user, get_optional_current_user
    from app.main import app
    from app.modules.guest_previews.dependencies import get_guest_preview_service

    session, storage, score, db, service = preview_context
    add_page(session, storage, 901, "page-a")
    add_audio(session, storage, 901)
    token = score.guest_preview_token
    score.guest_preview_enabled = True
    session.commit()

    async def database():
        yield db

    def no_account_authorization():
        raise AssertionError("Guest Preview must not resolve ambient account authority")

    app.dependency_overrides[get_current_user] = no_account_authorization
    app.dependency_overrides[get_optional_current_user] = no_account_authorization
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_guest_preview_service] = lambda: service
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    try:
        for cookies in [{}, {"noteverse_session": "ambient-invalid-login"}]:
            client.cookies.update(cookies)
            response = await client.get(f"/api/v1/guest-previews/{token}")
            assert response.status_code == 200
            assert response.headers["cache-control"] == "private, no-store"
            assert set(response.json()["data"]) == {
                "title",
                "shared_by",
                "render_assets",
                "audio_available",
            }
            assert response.json()["data"]["render_assets"] == [
                {"asset_id": "page-a", "page_number": 1}
            ]
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
    from app.modules.guest_previews.dependencies import get_guest_preview_service

    session, _, score, db, service = preview_context
    token = score.guest_preview_token
    user = session.get(User, 1)

    async def database():
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
            assert response.json()["data"] == {"enabled": False, "token": token}
            for enabled in [True, False, True]:
                response = await client.patch(url, json={"enabled": enabled})
                assert response.status_code == 200
                assert response.headers["cache-control"] == "private, no-store"
                assert response.json()["data"] == {"enabled": enabled, "token": token}
            user = session.get(User, 2)
            for method in [client.get, client.patch]:
                response = await method(
                    url, **({"json": {"enabled": False}} if method == client.patch else {})
                )
                assert response.status_code in {403, 404}
                assert response.headers["cache-control"] == "private, no-store"
                assert token not in response.text
    finally:
        for dependency in [get_db, get_current_user, get_guest_preview_service]:
            app.dependency_overrides.pop(dependency, None)


@pytest.fixture
def preview_http_app(preview_context):
    from app.api.deps import get_db
    from app.main import create_app
    from app.modules.guest_previews.dependencies import get_guest_preview_service

    _, _, _, db, service = preview_context
    application = create_app()

    async def database():
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

    session, _, score, _, _ = preview_context
    token = score.guest_preview_token
    score.guest_preview_enabled = state != "disabled"
    if state == "unknown":
        token = "unknown-token"
    elif state == "deleted":
        score.deleted_at = utc_now_naive()
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

    session, storage, score, _, _ = preview_context
    add_page(session, storage, 901, "page-a")
    add_audio(session, storage, 901)
    score.guest_preview_enabled = True
    session.commit()
    add_head_b(session, score)
    async with AsyncClient(
        transport=ASGITransport(app=preview_http_app), base_url="http://test"
    ) as client:
        for suffix in ["/render-assets/page-a/view", "/playback"]:
            response = await client.get(
                f"/api/v1/guest-previews/{score.guest_preview_token}{suffix}"
            )
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

    async def unavailable(*args):
        raise RuntimeError("Presentation service unavailable")

    monkeypatch.setattr(service, operation, unavailable)
    async with AsyncClient(
        transport=ASGITransport(app=preview_http_app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        response = await client.get(f"/api/v1/guest-previews/{score.guest_preview_token}{suffix}")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.asyncio
async def test_bearer_dependency_validation_response_is_not_cacheable(
    preview_context, preview_http_app
):
    from httpx import AsyncClient, ASGITransport
    from app.modules.guest_previews.dependencies import get_guest_preview_service

    _, _, score, _, service = preview_context

    def validated_service(required_number: int):
        return service

    preview_http_app.dependency_overrides[get_guest_preview_service] = validated_service
    async with AsyncClient(
        transport=ASGITransport(app=preview_http_app), base_url="http://test"
    ) as client:
        response = await client.get(
            f"/api/v1/guest-previews/{score.guest_preview_token}?required_number=invalid"
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
        response = await client.get("/api/v1/scores/preview-score/guest-preview")
        assert response.status_code == 401
        assert response.headers["cache-control"] == "private, no-store"
        preview_http_app.dependency_overrides[get_current_user] = lambda: User(id=1)
        response = await client.patch(
            "/api/v1/scores/preview-score/guest-preview", json={"enabled": "invalid"}
        )
        assert response.status_code == 422
        assert response.headers["cache-control"] == "private, no-store"
        response = await client.get("/api/v1/cache-policy-control")
        assert response.headers["cache-control"] == "public, max-age=60"
