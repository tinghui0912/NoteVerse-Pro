"""Actor commands preserve one terminal invitation outcome and durable history."""

from datetime import timedelta
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, func

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ValidationException
from app.db.models import ScoreInvite, ScoreMembership
from app.db.models.score_access import InviteStatus, MembershipRole
from app.main import app
from app.modules.score_invites.rules import hash_invite_token
from app.modules.score_invites.schemas import InviteCreateRequest
from app.modules.score_invites.service import ScoreInviteService
from app.modules.score_invites.repository import ScoreInviteRepository
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.test_trusted_collaboration import collaboration as collaboration


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,expired,error_code",
    [
        (InviteStatus.PENDING, False, None),
        (InviteStatus.REVOKED, False, None),
        (InviteStatus.ACCEPTED, False, ErrorCode.INVITE_ALREADY_ACCEPTED),
        (InviteStatus.DECLINED, False, ErrorCode.INVITE_DECLINED),
        (InviteStatus.EXPIRED, False, ErrorCode.INVITE_EXPIRED),
        (InviteStatus.PENDING, True, ErrorCode.INVITE_EXPIRED),
    ],
)
async def test_owner_revoke_http_uses_effective_lifecycle_and_preserves_membership(
    collaboration, status, expired, error_code
):
    session, _, score, db = collaboration
    original_time = utc_now_naive() - timedelta(days=1)
    invite = ScoreInvite(
        invite_uuid="lifecycle",
        score_id=score.id,
        token_hash=hash_invite_token("invite"),
        email="other@example.com",
        role=MembershipRole.VIEWER,
        status=status,
        created_by_user_id=1,
        expires_at=original_time if expired else None,
        revoked_at=original_time if status == InviteStatus.REVOKED else None,
    )
    session.add(invite)
    if status == InviteStatus.ACCEPTED:
        session.add(
            ScoreMembership(
                score_id=score.id, user_id=2, role=MembershipRole.VIEWER, created_by_user_id=1
            )
        )
    session.commit()

    async def database():
        yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/scores/{score.score_uuid}/invites/lifecycle/revoke"
            )
            assert response.status_code == (422 if error_code else 200), response.text
            if error_code:
                assert response.json()["public_code"] == error_code
            session.refresh(invite)
            expected = (
                InviteStatus.EXPIRED
                if expired
                else InviteStatus.REVOKED
                if error_code is None
                else status
            )
            assert invite.status == expected
            if expected == InviteStatus.REVOKED:
                revoked_at = invite.revoked_at
                assert revoked_at is not None
                if status == InviteStatus.REVOKED:
                    assert revoked_at == original_time
                assert (
                    await client.post(f"/api/v1/scores/{score.score_uuid}/invites/lifecycle/revoke")
                ).status_code == 200
                session.refresh(invite)
                assert invite.revoked_at == revoked_at
            else:
                assert invite.revoked_at is None
            # Invitations remain readable lifecycle records and expose no raw token.
            rows = (await client.get(f"/api/v1/scores/{score.score_uuid}/invites")).json()["data"][
                "items"
            ]
            assert len(rows) == 1 and "token" not in rows[0]
    finally:
        app.dependency_overrides.clear()
    active_members = session.scalar(
        select(func.count())
        .select_from(ScoreMembership)
        .where(ScoreMembership.revoked_at.is_(None))
    )
    assert active_members == (1 if status == InviteStatus.ACCEPTED else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    ["/invites/invite/accept", "/me/invites/lifecycle/accept", "/me/invites/lifecycle/decline"],
)
async def test_recipient_commands_persist_effective_expiry_without_access(collaboration, path):
    session, _, score, db = collaboration
    invite = ScoreInvite(
        invite_uuid="lifecycle",
        score_id=score.id,
        email="other@example.com",
        role=MembershipRole.VIEWER,
        token_hash=hash_invite_token("invite"),
        created_by_user_id=1,
        expires_at=utc_now_naive() - timedelta(seconds=1),
    )
    session.add(invite)
    session.commit()

    async def database():
        yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=2)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1" + path)
            assert response.status_code == 422
            assert response.json()["public_code"] == ErrorCode.INVITE_EXPIRED
    finally:
        app.dependency_overrides.clear()
    session.refresh(invite)
    assert invite.status == InviteStatus.EXPIRED
    assert session.scalar(select(func.count()).select_from(ScoreMembership)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("existing", [False, True])
async def test_accept_rechecks_expiry_after_membership_contention(
    collaboration, monkeypatch, existing
):
    session, _, score, db = collaboration
    now = utc_now_naive()
    clock = [now]
    monkeypatch.setattr("app.modules.score_invites.rules.utc_now_naive", lambda: clock[0])
    invite = ScoreInvite(
        invite_uuid="expiring",
        score_id=score.id,
        email="other@example.com",
        role=MembershipRole.VIEWER,
        token_hash=hash_invite_token("expiring"),
        created_by_user_id=1,
        expires_at=now + timedelta(seconds=1),
    )
    session.add(invite)
    if existing:
        session.add(
            ScoreMembership(
                score_id=score.id,
                user_id=2,
                role=MembershipRole.VIEWER,
                created_by_user_id=1,
                revoked_at=now,
            )
        )
    session.commit()

    class MembershipWait(ScoreInviteRepository):
        async def membership_for_update(self, db, score_id, user_id):
            membership = await super().membership_for_update(db, score_id, user_id)
            clock[0] = now + timedelta(seconds=2)
            return membership

    with pytest.raises(ValidationException) as error:
        await ScoreInviteService(repository=MembershipWait()).accept_invite(db, "expiring", 2)
    assert error.value.code == ErrorCode.INVITE_EXPIRED
    session.refresh(invite)
    assert invite.status == InviteStatus.EXPIRED
    membership = session.scalar(select(ScoreMembership))
    assert (
        (membership is not None and membership.revoked_at == now)
        if existing
        else membership is None
    )


@pytest.mark.asyncio
async def test_invitation_http_resource_retains_history_without_a_delete_command(collaboration):
    session, _, score, db = collaboration
    session.add(
        ScoreInvite(
            invite_uuid="retained",
            score_id=score.id,
            email="other@example.com",
            role=MembershipRole.VIEWER,
            token_hash=hash_invite_token("retained"),
            created_by_user_id=1,
        )
    )
    session.commit()

    async def database():
        yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.delete(f"/api/v1/scores/{score.score_uuid}/invites/retained")
            assert response.status_code in {404, 405}
    finally:
        app.dependency_overrides.clear()
    assert session.scalar(select(ScoreInvite)).invite_uuid == "retained"


@pytest.mark.asyncio
@pytest.mark.parametrize("command", ["leave", "remove"])
async def test_accepted_invitation_history_survives_membership_revocation(collaboration, command):
    session, _, score, db = collaboration
    service = ScoreInviteService()
    created = await service.create_invite(
        db, score.score_uuid, 1, InviteCreateRequest(email="other@example.com")
    )
    accepted = await service.accept_invite(db, created.token, 2)
    invite = session.scalar(select(ScoreInvite))
    accepted_at = invite.accepted_at
    if command == "leave":
        await service.leave_score(db, score.score_uuid, 2)
    else:
        await service.remove_member(db, score.score_uuid, accepted.membership_id, 1)
    session.refresh(invite)
    assert invite.status == InviteStatus.ACCEPTED and invite.accepted_at == accepted_at
    assert invite.revoked_at is None
    assert session.get(ScoreMembership, accepted.membership_id).revoked_at is not None
