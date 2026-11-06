"""Authenticated collaboration matrix and real source disclosure boundaries."""

from types import SimpleNamespace
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from app.api.deps import get_current_user, get_db
from app.core.exceptions import UnauthorizedException
from app.db.models import (
    ScoreMembership,
    ScoreInputAsset,
    StorageBlob,
    Upload,
    ScoreRevisionSource,
    ScoreInvite,
)
from app.db.models.score_access import MembershipRole, InviteStatus, AccessOrigin
from app.db.models.score import RevisionSourceFormat
from app.main import app
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.service import ScoreAssetService
from app.modules.scores.service import ScoreService
from app.modules.revisions.service import RevisionService
from app.modules.playback.delivery import PlaybackDeliveryService
from app.modules.playback.router import get_playback_delivery_service
from app.modules.practice.bundle.service import PracticeBundleService
from app.modules.practice.bundle.router import get_practice_bundle_service
from app.modules.score_assets.dependencies import get_score_asset_service
from app.modules.scores.dependencies import get_score_service, get_revision_service
from app.modules.score_invites.dependencies import get_score_invite_service
from app.modules.score_invites.service import ScoreInviteService
from app.modules.score_invites.schemas import InviteCreateRequest, MemberUpdateRequest
from app.modules.score_invites.rules import ROLE_RANK
from app.utils.timezone import utc_now_naive
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.test_score_revision_services import (
    add_active_score_with_head_revision,
    MUSICXML_2,
)
from tests.test_performance_takes import AsyncSessionAdapter, DEFAULT_TAKE_RECORDING_TIMEBASE
from tests.test_guest_previews import add_page, add_audio


ROLES = ["OWNER", "VIEWER", "PRACTITIONER", "EDITOR"]
ALLOWED = {
    "OWNER": set(ScoreAction),
    "VIEWER": {ScoreAction.VIEW},
    "PRACTITIONER": {ScoreAction.VIEW, ScoreAction.PRACTICE},
    "EDITOR": {ScoreAction.VIEW, ScoreAction.PRACTICE, ScoreAction.EDIT},
}


@pytest.fixture
def collaboration(score_service_session):
    session, storage = score_service_session
    score = add_active_score_with_head_revision(
        session,
        score_id=4000,
        revision_id=4001,
        score_uuid="trusted-score",
        revision_uuid="trusted-revision",
        title="Trusted score",
    )
    practice_xml = MUSICXML_2.replace(
        "<divisions>1</divisions>",
        "<divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>",
    )
    xml = storage.put_bytes(
        key="trusted/score.musicxml",
        content=practice_xml.encode(),
        content_type="application/vnd.recordare.musicxml+xml",
    )
    session.add(
        ScoreRevisionSource(
            source_uuid="trusted-source",
            revision_id=4001,
            format=RevisionSourceFormat.MUSICXML,

            storage_key=xml.storage_key,
            filename=xml.filename,
            mime_type="application/vnd.recordare.musicxml+xml",
            size_bytes=xml.size_bytes,
            sha256="a" * 64,
            generator="test",
            generator_version="1",
        )
    )
    image = storage.put_bytes(key="trusted/raw.png", content=b"original", content_type="image/png")
    session.add(
        StorageBlob(
            id=4002,
            blob_uuid="trusted-blob",
            sha256="b" * 64,

            storage_key=image.storage_key,
            filename="private-scan.png",
            mime_type="image/png",
            size_bytes=image.size_bytes,
        )
    )
    session.flush()
    session.add(
        Upload(
            id=4003,
            upload_uuid="trusted-upload",
            blob_id=4002,
            original_filename="private-scan.png",
            uploader_user_id=1,
        )
    )
    session.flush()
    session.add(ScoreInputAsset(asset_uuid="trusted-input", score_id=4000, upload_id=4003))
    session.commit()
    add_page(session, storage, 4001, "trusted-page")
    add_audio(session, storage, 4001)
    return session, storage, score, AsyncSessionAdapter(session)


def member_for(session, role):
    if role == "OWNER":
        return 1
    session.add(
        ScoreMembership(score_id=4000, user_id=2, role=MembershipRole(role), created_by_user_id=1)
    )
    session.commit()
    return 2


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ROLES)
async def test_every_action_is_authorized_by_the_canonical_matrix(collaboration, role):
    session, _, score, db = collaboration
    user_id = member_for(session, role)
    policy = ScoreAccessPolicy()
    access = await policy.resolve(db, score.score_uuid, user_id=user_id)
    assert access.origin == (AccessOrigin.OWNER if role == "OWNER" else AccessOrigin.MEMBERSHIP)
    for action in ScoreAction:
        if action in ALLOWED[role]:
            await policy.authorize(db, score.score_uuid, action, user_id=user_id)
        else:
            with pytest.raises(UnauthorizedException):
                await policy.authorize(db, score.score_uuid, action, user_id=user_id)


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ROLES)
async def test_http_source_disclosure_and_editing_boundaries(collaboration, role):
    session, storage, score, db = collaboration
    user_id = member_for(session, role)
    source = PracticeBundleService(storage=storage)
    admitted = await source.resolve_bundle(db, score.score_uuid, 1, "trusted-revision")
    bundle_id = admitted.bundle.bundle_id
    from app.modules.performance_takes.dependencies import get_performance_take_upload_service
    from app.modules.performance_takes.upload_reservation.service import (
        PerformanceTakeUploadService,
    )
    services = {
        get_performance_take_upload_service: PerformanceTakeUploadService(
            storage=storage, practice_bundle_service=source
        ),
        get_score_service: ScoreService(storage=storage),
        get_revision_service: RevisionService(storage=storage),
        get_score_asset_service: ScoreAssetService(storage=storage),
        get_practice_bundle_service: source,
        get_playback_delivery_service: PlaybackDeliveryService(storage=storage),
        get_score_invite_service: ScoreInviteService(),
    }

    async def database():
        yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=user_id, is_active=True)
    for dependency, service in services.items():
        app.dependency_overrides[dependency] = lambda service=service: service
    can_edit = ScoreAction.EDIT in ALLOWED[role]
    can_practice = ScoreAction.PRACTICE in ALLOWED[role]
    can_download = role == "OWNER"
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            detail = await client.get("/api/v1/scores/trusted-score")
            assert detail.status_code == 200
            assert bool(detail.json()["data"]["input_assets"]) == can_edit
            assets = await client.get("/api/v1/scores/trusted-score/revision-assets")
            assert assets.status_code == 200
            assert bool(assets.json()["data"]["revision_sources"]) == can_edit
            assert len(assets.json()["data"]["render_assets"]) == 1
            reads = [
                ("/scores/trusted-score/revisions/trusted-revision/content", can_edit),
                ("/scores/trusted-score/revisions", can_edit),
                ("/scores/trusted-score/input-assets/trusted-input/download", can_edit),
                ("/revision-sources/trusted-source/download", can_download),
                ("/revision-sources/trusted-source/access-url", can_download),
                ("/render-assets/trusted-page/download", can_download),
                ("/render-assets/trusted-page/access-url", can_download),
                ("/scores/trusted-score/render-asset-archive?kind=RENDERED_PAGE", can_download),
                ("/render-assets/trusted-page/view", True),
                (
                    "/practice/scores/trusted-score/revisions/trusted-revision/bundle?include_notation=true",
                    can_practice,
                ),
                ("/scores/trusted-score/revisions/trusted-revision/playback", can_practice),
                ("/scores/trusted-score/members", role == "OWNER"),
                ("/scores/trusted-score/guest-previews", role == "OWNER"),
            ]
            for path, allowed in reads:
                response = await client.get("/api/v1" + path)
                assert response.status_code == (200 if allowed else 403), (
                    role,
                    path,
                    response.text[:200],
                )
                if path.endswith("/view") and allowed:
                    assert response.headers["content-disposition"].startswith("inline")
            for path, payload in [
                (
                    "/scores/trusted-score/revisions",
                    dict(
                        expected_head_revision_id="trusted-revision",
                        content=MUSICXML_2,
                        idempotency_key="editing-noop",
                    ),
                ),
                ("/scores/trusted-score/revisions/trusted-revision/restore", dict(note="Restore")),
            ]:
                response = await client.post("/api/v1" + path, json=payload)
                assert response.status_code == (200 if can_edit else 403), (
                    path,
                    response.text[:200],
                )
            response = await client.patch(
                "/api/v1/scores/trusted-score/revisions/trusted-revision/note",
                json={"note": "Collaboration note"},
            )
            assert response.status_code == (200 if can_edit else 403)
            reservation = await client.post(
                "/api/v1/performance-takes/upload-reservations",
                json={
                    "client_request_id": f"matrix-{role}",
                    "practice_binding": {"score_id": "trusted-score", "revision_id": "trusted-revision", "bundle_id": bundle_id},
                    "media": {
                        "kind": "AUDIO",
                        "mime_type": "audio/webm",
                        "byte_size": 100,
                    },
                    "scope": {"kind": "FULL"},
                    "tempo_selection": {"mode": "SCORE"},
                    "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
                },
            )
            assert reservation.status_code == (200 if can_practice else 403), reservation.text[:200]
            if can_practice:
                saved = await source.authorize_bundle_for_save(db,user_id,"trusted-score","trusted-revision",bundle_id)
                assert saved.bundle.bundle_id == bundle_id
            else:
                with pytest.raises(UnauthorizedException):
                    await source.authorize_bundle_for_save(db,user_id,"trusted-score","trusted-revision",bundle_id)
    finally:
        for dependency in [get_db, get_current_user, *services]:
            app.dependency_overrides.pop(dependency, None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "existing,invited,expected",
    [
        (None, "VIEWER", "VIEWER"),
        (None, "PRACTITIONER", "PRACTITIONER"),
        (None, "EDITOR", "EDITOR"),
        ("VIEWER", "PRACTITIONER", "PRACTITIONER"),
        ("PRACTITIONER", "VIEWER", "PRACTITIONER"),
        ("PRACTITIONER", "EDITOR", "EDITOR"),
        ("EDITOR", "VIEWER", "EDITOR"),
        ("EDITOR", "PRACTITIONER", "EDITOR"),
    ],
)
@pytest.mark.parametrize("revoked", [False, True])
async def test_invite_acceptance_preserves_role_rank(
    collaboration, existing, invited, expected, revoked
):
    session, _, score, db = collaboration
    if existing is not None:
        member_for(session, existing)
        member = session.execute(select(ScoreMembership)).scalar_one()
        if revoked:
            member.revoked_at = utc_now_naive() - timedelta(days=1)
            session.add(member)
            session.commit()
    service = ScoreInviteService()
    created = await service.create_invite(
        db,
        score.score_uuid,
        1,
        InviteCreateRequest(email="other@example.com", role=MembershipRole(invited)),
    )
    result = await service.accept_invite(db, created.token, 2)
    assert result.role == MembershipRole(expected)
    membership = session.execute(select(ScoreMembership)).scalar_one()
    assert membership.role == MembershipRole(expected) and membership.revoked_at is None
    assert session.execute(select(ScoreInvite)).scalar_one().status == InviteStatus.ACCEPTED


@pytest.mark.asyncio
async def test_explicit_member_changes_and_revocation_apply_immediately(collaboration):
    session, _, score, db = collaboration
    member_for(session, "VIEWER")
    member = session.execute(select(ScoreMembership)).scalar_one()
    service = ScoreInviteService()
    policy = ScoreAccessPolicy()
    for role in ["PRACTITIONER", "EDITOR", "VIEWER"]:
        await service.update_member(
            db, score.score_uuid, member.id, 1, MemberUpdateRequest(role=MembershipRole(role))
        )
        access = await policy.resolve(db, score.score_uuid, user_id=2)
        assert access.capabilities.can_practice == (role != "VIEWER")
        assert access.capabilities.can_edit == (role == "EDITOR")
    await service.remove_member(db, score.score_uuid, member.id, 1)
    for action in [ScoreAction.VIEW, ScoreAction.PRACTICE, ScoreAction.EDIT]:
        with pytest.raises(UnauthorizedException):
            await policy.authorize(db, score.score_uuid, action, user_id=2)


def test_least_privilege_default_and_exact_role_hierarchy():
    assert InviteCreateRequest(email="member@example.com").role == MembershipRole.VIEWER
    assert ROLE_RANK == {
        MembershipRole.VIEWER: 1,
        MembershipRole.PRACTITIONER: 2,
        MembershipRole.EDITOR: 3,
    }
