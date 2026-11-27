"""Actor outcomes are coherent durable facts; expiry is a read-only time projection."""

from contextlib import contextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, func, event
from app.platform.db.dependencies import get_db
from app.runtime.customer_api.deps import get_current_user
from app.core.exceptions import ValidationException
from app.db.models import ScoreInvite, ScoreMembership, MailOutbox, Notification, User
from app.db.models.score_access import InviteTerminalOutcome, MembershipRole
from app.runtime.customer_api.main import app
from app.modules.collaboration.invite_lifecycle import InviteStatus, effective_invite_status
from app.modules.collaboration.invite_lifecycle import hash_invite_token
from app.modules.collaboration.schemas import InviteCreateRequest
from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.membership_service import MembershipService
from app.modules.collaboration.repository import CollaborationRepository
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.test_trusted_collaboration import collaboration as collaboration
from app.platform.config.application import InvitationConfig
from app.runtime.customer_api.context import get_context


@contextmanager
def observe_writes(session):
    writes, commits = [], []

    def statement(connection, cursor, sql, parameters, context, many):
        if sql.lstrip().split()[0].upper() in {"UPDATE", "INSERT", "DELETE"}:
            writes.append(sql)

    def committed(session):
        commits.append(True)

    engine = session.get_bind()
    event.listen(engine, "before_cursor_execute", statement)
    event.listen(session, "after_commit", committed)
    try:
        yield writes, commits
    finally:
        event.remove(engine, "before_cursor_execute", statement)
        event.remove(session, "after_commit", committed)


def facts(invite):
    return invite.terminal_outcome, invite.terminal_at, invite.terminal_actor_user_id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "outcome,expired,error_code",
    [
        (None, False, None),
        (InviteTerminalOutcome.REVOKED, False, None),
        (InviteTerminalOutcome.ACCEPTED, False, CustomerErrorCode.INVITE_ALREADY_ACCEPTED),
        (InviteTerminalOutcome.DECLINED, False, CustomerErrorCode.INVITE_DECLINED),
        (None, True, CustomerErrorCode.INVITE_EXPIRED),
    ],
)
async def test_owner_revoke_http_admits_effective_status_without_writing_rejections(
    collaboration, outcome, expired, error_code
):
    session, _, score, db = collaboration
    original_time = utc_now() - timedelta(days=1)
    invite = ScoreInvite(
        invite_uuid="lifecycle",
        score_id=score.id,
        token_hash=hash_invite_token("invite"),
        email="other@example.com",
        role=MembershipRole.VIEWER,
        created_by_user_id=1,
        expires_at=original_time if expired else None,
        terminal_outcome=outcome,
        terminal_at=original_time if outcome else None,
        terminal_actor_user_id=2 if outcome else None,
    )
    session.add(invite)
    if outcome == InviteTerminalOutcome.ACCEPTED:
        session.add(
            ScoreMembership(
                score_id=score.id, user_id=2, role=MembershipRole.VIEWER, created_by_user_id=1
            )
        )
    session.commit()
    original = facts(invite)

    def database():
        yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with observe_writes(session) as (writes, commits):
                response = await client.post(
                    f"/api/v1/scores/{score.score_uuid}/invites/lifecycle/revoke"
                )
                assert response.status_code == (422 if error_code else 200), response.text
                if error_code:
                    assert response.json()["code"] == error_code
                    assert writes == commits == []
            session.refresh(invite)
            if error_code:
                assert facts(invite) == original
            else:
                assert invite.terminal_outcome == InviteTerminalOutcome.REVOKED
                if outcome is None:
                    assert invite.terminal_actor_user_id == 1 and invite.terminal_at is not None
                else:
                    assert facts(invite) == original
                terminal = facts(invite)
                assert (
                    await client.post(f"/api/v1/scores/{score.score_uuid}/invites/lifecycle/revoke")
                ).status_code == 200
                session.refresh(invite)
                assert facts(invite) == terminal
            with observe_writes(session) as (writes, commits):
                read = (await client.get(f"/api/v1/scores/{score.score_uuid}/invites")).json()[
                    "items"
                ][0]
                inspected = (await client.get("/api/v1/invites/invite")).json()
                assert writes == commits == []
            assert (
                read["status"]
                == inspected["status"]
                == effective_invite_status(invite, now=utc_now())
            )
            assert "token" not in read
            if invite.terminal_at is None:
                assert read["terminal_at"] is None
            else:
                assert datetime.fromisoformat(read["terminal_at"]) == invite.terminal_at
            assert (
                read["terminal_actor"] is None
                if invite.terminal_actor_user_id is None
                else read["terminal_actor"]["email"]
                == (
                    "owner@example.com"
                    if invite.terminal_actor_user_id == 1
                    else "other@example.com"
                )
            )
    finally:
        app.dependency_overrides.clear()
    assert session.scalar(
        select(func.count())
        .select_from(ScoreMembership)
        .where(ScoreMembership.revoked_at.is_(None))
    ) == (1 if outcome == InviteTerminalOutcome.ACCEPTED else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    ["/invites/invite/accept", "/me/invites/lifecycle/accept", "/me/invites/lifecycle/decline"],
)
async def test_expired_recipient_command_has_no_write_or_commit(collaboration, path):
    session, _, score, db = collaboration
    invite = ScoreInvite(
        invite_uuid="lifecycle",
        score_id=score.id,
        email="other@example.com",
        role=MembershipRole.VIEWER,
        token_hash=hash_invite_token("invite"),
        created_by_user_id=1,
        expires_at=utc_now() - timedelta(seconds=1),
    )
    session.add(invite)
    session.commit()

    def database():
        yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=2)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with observe_writes(session) as (writes, commits):
                response = await client.post("/api/v1" + path)
                assert response.status_code == 422
                assert response.json()["code"] == CustomerErrorCode.INVITE_EXPIRED
                assert writes == commits == []
    finally:
        app.dependency_overrides.clear()
    session.refresh(invite)
    assert facts(invite) == (None, None, None)
    assert effective_invite_status(invite, now=utc_now()) == InviteStatus.EXPIRED
    assert session.scalar(select(func.count()).select_from(ScoreMembership)) == 0


@pytest.mark.parametrize("existing", [False, True])
def test_accept_rechecks_expiry_after_membership_contention(collaboration, monkeypatch, existing):
    session, _, score, db = collaboration
    now = utc_now()
    clock = [now]
    monkeypatch.setattr("app.modules.collaboration.invitation_service.utc_now", lambda: clock[0])
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

    class MembershipWait(CollaborationRepository):
        def membership_for_update(self, db, score_id, user_id):
            membership = super().membership_for_update(db, score_id, user_id)
            clock[0] = now + timedelta(seconds=2)
            return membership

    with observe_writes(session) as (writes, commits):
        with pytest.raises(ValidationException) as error:
            InvitationService(
                repository=MembershipWait(),
                config=InvitationConfig.model_validate(get_context().settings.model_dump()),
            ).accept_invite(db, "expiring", 2)
        assert error.value.code == CustomerErrorCode.INVITE_EXPIRED
        assert writes == commits == []
    session.refresh(invite)
    assert facts(invite) == (None, None, None)
    membership = session.scalar(select(ScoreMembership))
    if existing:
        assert membership.revoked_at == now
    else:
        assert membership is None


@pytest.mark.parametrize("command", ["leave", "remove"])
def test_accepted_actor_facts_survive_membership_revocation(collaboration, command):
    session, _, score, db = collaboration
    service = InvitationService(
        config=InvitationConfig.model_validate(get_context().settings.model_dump())
    )
    created = service.create_invite(
        db, score.score_uuid, 1, InviteCreateRequest(email="other@example.com")
    )
    accepted = service.accept_invite(db, created.token, 2)
    invite = session.scalar(select(ScoreInvite))
    terminal = facts(invite)
    assert (
        terminal[0] == InviteTerminalOutcome.ACCEPTED
        and terminal[1] is not None
        and terminal[2] == 2
    )
    if command == "leave":
        MembershipService().leave_score(db, score.score_uuid, 2)
    else:
        MembershipService().remove_member(db, score.score_uuid, accepted.membership_id, 1)
    session.refresh(invite)
    assert facts(invite) == terminal
    assert session.get(ScoreMembership, accepted.membership_id).revoked_at is not None


def test_owner_email_cannot_enter_the_invitation_lifecycle(collaboration):
    db, _, score, _ = collaboration
    owner = db.get(User, 1)
    with observe_writes(db) as (writes, commits):
        with pytest.raises(ValidationException):
            InvitationService(
                config=InvitationConfig.model_validate(get_context().settings.model_dump())
            ).create_invite(db, score.score_uuid, 1, InviteCreateRequest(email=owner.email))
    assert writes == [] and commits == []
    assert db.scalar(select(ScoreInvite)) is None and db.scalar(select(MailOutbox)) is None


def test_invitation_targeting_owner_fails_closed_without_terminal_or_membership_facts(
    collaboration,
):
    db, _, score, _ = collaboration
    owner = db.get(User, 1)
    invite = ScoreInvite(
        score_id=score.id,
        email=owner.email,
        token_hash=hash_invite_token("self"),
        role=MembershipRole.EDITOR,
        created_by_user_id=1,
    )
    db.add(invite)
    db.commit()
    with observe_writes(db) as (writes, commits):
        with pytest.raises(ValidationException):
            InvitationService(
                config=InvitationConfig.model_validate(get_context().settings.model_dump())
            ).accept_invite(db, "self", 1)
    assert writes == [] and commits == []
    assert invite.terminal_outcome is None and invite.terminal_at is None
    assert db.scalar(select(ScoreMembership)) is None and db.scalar(select(Notification)) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["token", "pending"])
@pytest.mark.parametrize("membership_state", ["new", "active", "revoked"])
async def test_acceptance_returns_the_persisted_collaborator_identity(
    collaboration, endpoint, membership_state
):
    db, _, score, _ = collaboration
    original_id = None
    if membership_state != "new":
        membership = ScoreMembership(
            score_id=score.id,
            user_id=2,
            role=MembershipRole.VIEWER,
            created_by_user_id=1,
            revoked_at=utc_now() if membership_state == "revoked" else None,
        )
        db.add(membership)
        db.commit()
        original_id = membership.id
    invite = InvitationService(
        config=InvitationConfig.model_validate(get_context().settings.model_dump())
    ).create_invite(db, score.score_uuid, 1, InviteCreateRequest(email="other@example.com"))
    path = (
        f"/api/v1/invites/{invite.token}/accept"
        if endpoint == "token"
        else f"/api/v1/me/invites/{invite.invite_id}/accept"
    )
    overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=2)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(path)
        assert response.status_code == 200, response.text
        returned_id = response.json()["membership_id"]
        assert type(returned_id) is int
        memberships = db.scalars(
            select(ScoreMembership).where(
                ScoreMembership.score_id == score.id, ScoreMembership.user_id == 2
            )
        ).all()
        assert len(memberships) == 1
        assert returned_id == memberships[0].id
        assert memberships[0].revoked_at is None
        if original_id is not None:
            assert returned_id == original_id
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides)
