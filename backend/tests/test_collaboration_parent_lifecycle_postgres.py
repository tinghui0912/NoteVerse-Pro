"""Active Score admission serializes child actor commands with parent deletion."""

from datetime import timedelta
from queue import Queue
from threading import Thread
from time import monotonic
from unittest.mock import patch

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException
from app.db.models import (
    MailOutbox,
    Notification,
    Score,
    ScoreInvite,
    ScoreMembership,
    User,
)
from app.db.models.score_access import InviteTerminalOutcome, MembershipRole
from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.invite_lifecycle import hash_invite_token
from app.modules.collaboration.membership_service import MembershipService
from app.modules.collaboration.schemas import InviteCreateRequest, MemberUpdateRequest
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.scores.lifecycle_service import ScoreLifecycleService
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now
from tests.test_score_revision_services import add_active_score_with_head_revision


@pytest.fixture
def parent_graph(postgres_engine):
    with Session(postgres_engine) as db:
        db.add_all(
            [
                User(id=1, email="owner@example.com", password_hash="hash"),
                User(id=2, email="member@example.com", password_hash="hash"),
            ]
        )
        db.flush()
        add_active_score_with_head_revision(
            db,
            score_id=10,
            revision_id=11,
            score_uuid="shared",
            revision_uuid="head",
            title="Shared",
        )
        db.add(
            ScoreInvite(
                invite_uuid="invitation",
                score_id=10,
                email="member@example.com",
                role=MembershipRole.EDITOR,
                token_hash=hash_invite_token("token"),
                created_by_user_id=1,
            )
        )
        member = ScoreMembership(
            score_id=10, user_id=2, role=MembershipRole.VIEWER, created_by_user_id=1
        )
        db.add(member)
        db.commit()
        member_id = member.id
    return postgres_engine, member_id


def run_command(db, action, member_id):
    invitations, members = InvitationService(), MembershipService()
    if action == "delete":
        ScoreLifecycleService().admit_deletions(db, ["shared"], 1)
        db.commit()
    elif action == "create":
        invitations.create_invite(
            db,
            "shared",
            1,
            InviteCreateRequest(email="new@example.com", role=MembershipRole.VIEWER),
        )
    elif action == "token_accept":
        invitations.accept_invite(db, "token", 2)
    elif action == "account_accept":
        invitations.accept_pending_invite(db, "invitation", 2)
    elif action == "decline":
        invitations.decline_pending_invite(db, "invitation", 2)
    elif action == "revoke":
        invitations.revoke_invite(db, "shared", "invitation", 1)
    elif action == "update":
        members.update_member(
            db, "shared", member_id, 1, MemberUpdateRequest(role=MembershipRole.EDITOR)
        )
    elif action == "remove":
        members.remove_member(db, "shared", member_id, 1)
    elif action == "leave":
        members.leave_score(db, "shared", 2)
    else:
        raise AssertionError(action)


@pytest.mark.parametrize(
    "action",
    [
        "create",
        "token_accept",
        "account_accept",
        "decline",
        "revoke",
        "update",
        "remove",
        "leave",
    ],
)
@pytest.mark.parametrize("delete_first", [True, False])
def test_parent_lifecycle_serializes_collaboration_commands(parent_graph, action, delete_first):
    engine, member_id = parent_graph
    revoked_at = utc_now() - timedelta(days=1)
    if action in {"token_accept", "account_accept"}:
        with Session(engine) as db:
            db.get(ScoreMembership, member_id).revoked_at = revoked_at
            db.commit()
    first, second = ("delete", action) if delete_first else (action, "delete")
    ready, result = Queue(), Queue()
    with Session(engine, expire_on_commit=False) as winner:
        with patch.object(winner, "commit", side_effect=winner.flush):
            run_command(winner, first, member_id)
        winner_pid = winner.scalar(text("SELECT pg_backend_pid()"))

        def contender():
            try:
                with Session(engine) as db:
                    # Stale discovery/identity-map objects must not bypass the locked re-read.
                    cached = [
                        db.get(Score, 10),
                        db.scalar(select(ScoreInvite)),
                        db.get(ScoreMembership, member_id),
                    ]
                    assert cached[0].deleted_at is None
                    ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                    run_command(db, second, member_id)
                result.put(None)
            except BaseException as exc:
                result.put(exc)

        thread = Thread(target=contender)
        thread.start()
        try:
            waiting_pid = ready.get(timeout=10)
            deadline = monotonic() + 10
            with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                while not observer.scalar(
                    text("SELECT :winner = ANY(pg_blocking_pids(:waiting))"),
                    {"winner": winner_pid, "waiting": waiting_pid},
                ):
                    assert monotonic() < deadline, "Command must contend on the Score parent"
                query = observer.scalar(
                    text("SELECT query FROM pg_stat_activity WHERE pid=:pid"), {"pid": waiting_pid}
                )
                assert "scores" in query.lower() and "for update" in query.lower()
            winner.commit()
        finally:
            winner.rollback()
            thread.join(timeout=10)
        assert not thread.is_alive()
        error = result.get(timeout=1)
        if delete_first:
            assert isinstance(error, ResourceNotFoundException)
            assert error.code == (
                CustomerErrorCode.INVITE_NOT_FOUND
                if action in {"token_accept", "account_accept", "decline"}
                else CustomerErrorCode.SCORE_NOT_FOUND
            )
        else:
            assert error is None

    with Session(engine) as db:
        assert db.get(Score, 10).deleted_at is not None
        with pytest.raises(ResourceNotFoundException):
            ScoreAccessPolicy().resolve_score(db, "shared", user_id=2)
        invitation = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == "invitation"))
        member = db.get(ScoreMembership, member_id)
        expected_outcome = (
            None
            if delete_first
            else {
                "token_accept": InviteTerminalOutcome.ACCEPTED,
                "account_accept": InviteTerminalOutcome.ACCEPTED,
                "decline": InviteTerminalOutcome.DECLINED,
                "revoke": InviteTerminalOutcome.REVOKED,
            }.get(action)
        )
        assert invitation.terminal_outcome == expected_outcome
        assert (invitation.terminal_at is None) == (expected_outcome is None)
        assert (invitation.terminal_actor_user_id is None) == (expected_outcome is None)
        assert db.scalar(select(func.count()).select_from(ScoreInvite)) == (
            2 if action == "create" and not delete_first else 1
        )
        assert db.scalar(select(func.count()).select_from(MailOutbox)) == (
            1 if action == "create" and not delete_first else 0
        )
        assert db.scalar(select(func.count()).select_from(Notification)) == (
            1 if action in {"token_accept", "account_accept", "decline"} and not delete_first else 0
        )
        assert db.scalar(select(func.count()).select_from(ScoreMembership)) == 1
        if delete_first:
            assert member.role == MembershipRole.VIEWER
            assert member.revoked_at == (revoked_at if "accept" in action else None)
        elif action in {"token_accept", "account_accept", "update"}:
            assert member.role == MembershipRole.EDITOR and member.revoked_at is None
        elif action in {"remove", "leave"}:
            assert member.revoked_at is not None


def test_pending_page_admits_active_parents_before_limit_and_seek(parent_graph):
    engine, _ = parent_graph
    with Session(engine) as db:
        add_active_score_with_head_revision(
            db,
            score_id=20,
            revision_id=21,
            score_uuid="active",
            revision_uuid="active-head",
            title="Active",
        )
        for n in range(3):
            db.add(
                ScoreInvite(
                    invite_uuid=f"active-{n}",
                    score_id=20,
                    email="member@example.com",
                    role=MembershipRole.VIEWER,
                    token_hash=hash_invite_token(f"active-token-{n}"),
                    created_by_user_id=1,
                )
            )
        db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == "invitation")).created_at = (
            utc_now() + timedelta(seconds=1)
        )
        db.commit()
        ScoreLifecycleService().admit_deletions(db, ["shared"], 1)
        db.commit()
        seen, cursor = [], None
        while True:
            page = InvitationService().list_my_pending_invites(db, 2, limit=1, cursor=cursor)
            assert len(page.items) == 1
            seen.extend(item.invite_id for item in page.items)
            cursor = page.next_cursor
            if cursor is None:
                break
        assert len(seen) == 3 and set(seen) == {f"active-{n}" for n in range(3)}
