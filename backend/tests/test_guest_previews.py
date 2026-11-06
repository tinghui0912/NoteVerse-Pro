"""Presentation-only bearer access pins exactly one revision."""

from app.db.models import StoredObject

from datetime import timedelta, timezone
from hashlib import sha256

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.models import (
    PlaybackAssetKind,
    ScoreGuestPreviewGrant,
    ScoreRevision,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    ScoreLibraryEntry,
    ScoreMembership,
    ScoreDeletionStatus,
)
from app.db.models.score import RevisionOrigin, RenderAssetKind
from app.modules.guest_previews.schemas import GuestPreviewCreateRequest
from app.modules.guest_previews.service import GuestPreviewService
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.utils.timezone import utc_now_naive
from tests.test_score_revision_services import (
    AsyncSessionAdapter,
    add_active_score_with_head_revision,
)
from tests.test_score_revision_services import score_service_session as score_service_session


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


def assert_presentation_only(value):
    forbidden = {
        "musicxml",
        "revision_sources",
        "source_id",
        "source_uuid",
        "storage_key",
        "download_url",
        "can_practice",
        "can_download",
    }
    if isinstance(value, dict):
        assert not forbidden.intersection(k.lower() for k in value)
        for item in value.values():
            assert_presentation_only(item)
    elif isinstance(value, list):
        for item in value:
            assert_presentation_only(item)


@pytest.mark.asyncio
async def test_preview_pins_revision_and_never_falls_back(preview_context):
    session, storage, score, db, service = preview_context
    a = add_page(session, storage, 901, "page-a")
    created = await service.create(db, score.score_uuid, 1, GuestPreviewCreateRequest())
    row = session.execute(select(ScoreGuestPreviewGrant)).scalar_one()
    assert row.revision_id == 901
    assert row.token_hash == sha256(created.token.encode()).hexdigest()
    assert created.token not in repr(row)
    assert timedelta(days=6, hours=23) < row.expires_at - row.created_at <= timedelta(days=7)
    add_head_b(session, score)
    add_page(session, storage, 902, "page-b")
    add_audio(session, storage, 902)
    detail = await service.read(db, created.token)
    assert [p.asset_id for p in detail.render_assets] == ["page-a"]
    assert not detail.audio_available
    assert_presentation_only(detail.model_dump())
    assert (
        await service.image(db, created.token, "page-a")
    ).storage_key == a.stored_object.object_key
    with pytest.raises(ResourceNotFoundException):
        await service.image(db, created.token, "page-b")
    with pytest.raises(ResourceNotFoundException):
        await service.audio(db, created.token)
    add_audio(session, storage, 901)
    assert (await service.read(db, created.token)).audio_available
    assert (await service.audio(db, created.token)).storage_key.endswith("901.wav")
    session.delete(a)
    session.commit()
    assert (await service.read(db, created.token)).render_assets == []
    assert all(
        "token" not in item.model_dump()
        for item in await service.list(db, score.score_uuid, 1, limit=100)
    )
    assert session.execute(select(ScoreLibraryEntry)).all() == []
    assert session.execute(select(ScoreMembership)).all() == []
    with pytest.raises(UnauthorizedException):
        await ScoreAccessPolicy().authorize(db, score.score_uuid, ScoreAction.PRACTICE, user_id=2)
    with pytest.raises(UnauthorizedException):
        await service.create(db, score.score_uuid, 2, GuestPreviewCreateRequest())


@pytest.mark.asyncio
async def test_preview_revocation_expiry_and_score_deletion(preview_context):
    session, _, score, db, service = preview_context
    created = await service.create(db, score.score_uuid, 1, GuestPreviewCreateRequest())
    await service.revoke(db, created.preview_id, 1)
    revoked = await service.revoke(db, created.preview_id, 1)
    assert revoked.revoked_at is not None
    with pytest.raises(UnauthorizedException, match="guest_preview_revoked"):
        await service.read(db, created.token)
    new = await service.create(db, score.score_uuid, 1, GuestPreviewCreateRequest())
    assert new.token != created.token
    await service.read(db, new.token)
    row = session.execute(
        select(ScoreGuestPreviewGrant).where(ScoreGuestPreviewGrant.preview_uuid == new.preview_id)
    ).scalar_one()
    row.expires_at = utc_now_naive() - timedelta(seconds=1)
    session.add(row)
    session.commit()
    with pytest.raises(UnauthorizedException, match="guest_preview_expired"):
        await service.read(db, new.token)
    fresh = await service.create(db, score.score_uuid, 1, GuestPreviewCreateRequest())
    score.deletion_status = ScoreDeletionStatus.DELETING
    session.add(score)
    session.commit()
    with pytest.raises(ResourceNotFoundException):
        await service.read(db, fresh.token)


@pytest.mark.asyncio
@pytest.mark.parametrize("days", [-1, 0, 31])
async def test_expiration_is_server_validated(preview_context, days):
    _, _, score, db, service = preview_context
    with pytest.raises(ValidationException):
        await service.create(
            db,
            score.score_uuid,
            1,
            GuestPreviewCreateRequest(expires_at=utc_now_naive() + timedelta(days=days)),
        )


@pytest.mark.asyncio
async def test_aware_expiration_is_normalized(preview_context):
    session, _, score, db, service = preview_context
    expires = (utc_now_naive() + timedelta(days=1)).replace(tzinfo=timezone.utc)
    await service.create(db, score.score_uuid, 1, GuestPreviewCreateRequest(expires_at=expires))
    assert session.execute(
        select(ScoreGuestPreviewGrant)
    ).scalar_one().expires_at == expires.replace(tzinfo=None)


@pytest.mark.parametrize(
    "fields", [{"allow_download": True}, {"access_mode": "PRACTICE"}, {"allow_practice": True}]
)
def test_create_accepts_only_expiration_intent(fields):
    with pytest.raises(ValidationError):
        GuestPreviewCreateRequest.model_validate(fields)


@pytest.mark.asyncio
async def test_composite_fk_prevents_cross_score_revision(preview_context):
    session, _, _, _, _ = preview_context
    other = add_active_score_with_head_revision(
        session,
        score_id=910,
        revision_id=911,
        score_uuid="other-score",
        revision_uuid="other-revision",
        title="Other",
    )
    session.add(
        ScoreGuestPreviewGrant(
            score_id=900,
            revision_id=other.head_revision_id,
            token_hash="f" * 64,
            expires_at=utc_now_naive() + timedelta(days=1),
            created_by_user_id=1,
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


@pytest.mark.asyncio
async def test_bearer_routes_are_anonymous_inline_private_and_disclosure_safe(preview_context):
    from httpx import AsyncClient, ASGITransport
    from app.api.deps import get_db, get_current_user, get_optional_current_user
    from app.main import app
    from app.modules.guest_previews.dependencies import get_guest_preview_service

    session, storage, score, db, service = preview_context
    add_page(session, storage, 901, "page-a")
    add_audio(session, storage, 901)
    token = "unlogged-secret"
    session.add(
        ScoreGuestPreviewGrant(
            score_id=score.id,
            revision_id=901,
            token_hash=sha256(token.encode()).hexdigest(),
            expires_at=utc_now_naive() + timedelta(days=1),
            created_by_user_id=1,
        )
    )
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
            assert_presentation_only(response.json())
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
        assert session.execute(select(ScoreLibraryEntry)).all() == []
        assert session.execute(select(ScoreMembership)).all() == []
    finally:
        await client.aclose()
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_optional_current_user, None)
        app.dependency_overrides.pop(get_guest_preview_service, None)


def test_preview_token_is_redacted_from_structured_and_plain_logs():
    from app.core.logger import SensitiveDataFilter

    path = "/api/v1/guest-previews/raw-bearer-secret/render-assets/a/view"
    assert "raw-bearer-secret" not in SensitiveDataFilter.filter_string(path)
    assert "raw-bearer-secret" not in str(SensitiveDataFilter.filter_dict({"http_path": path}))


@pytest.mark.asyncio
@pytest.mark.parametrize("cleanup_mode", ["async", "sync"])
@pytest.mark.parametrize("end_pin", ["revoked", "expired"])
async def test_active_preview_retains_exact_presentation_until_pin_ends(
    preview_context, cleanup_mode, end_pin
):
    from app.modules.revisions.derived_asset_retention_service import DerivedAssetRetentionService

    session, storage, score, db, previews = preview_context
    page = add_page(session, storage, 901, "retained-page")
    page_key = page.stored_object.object_key
    add_audio(session, storage, 901)
    created = await previews.create(db, score.score_uuid, 1, GuestPreviewCreateRequest())
    add_head_b(session, score)
    cleanup = DerivedAssetRetentionService(storage)
    options = dict(score_id=score.id)

    async def run_cleanup():
        if cleanup_mode == "sync":
            return cleanup.cleanup_for_score_sync(session, **options)
        return await cleanup.cleanup_for_score(db, **options)

    result = await run_cleanup()
    assert result.rendered_pages_deleted == result.playback_assets_deleted == 0
    assert storage.exists(page_key)
    detail = await previews.read(db, created.token)
    assert detail.audio_available and [p.asset_id for p in detail.render_assets] == [
        "retained-page"
    ]
    if end_pin == "revoked":
        await previews.revoke(db, created.preview_id, 1)
    else:
        row = session.execute(select(ScoreGuestPreviewGrant)).scalar_one()
        row.expires_at = utc_now_naive() - timedelta(seconds=1)
        session.add(row)
        session.commit()
    result = await run_cleanup()
    expected_deletions = 0 if end_pin == "revoked" else 1
    assert result.rendered_pages_deleted == result.playback_assets_deleted == expected_deletions
    assert not storage.exists(page_key)
