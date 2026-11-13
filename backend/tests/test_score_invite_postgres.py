"""Invitation commands contend on the current row and preserve the winning terminal state."""

import asyncio
from datetime import timedelta
from queue import Queue
from threading import Thread
from time import monotonic

import pytest
from alembic import command
from sqlalchemy import select, text, func
from sqlalchemy.orm import Session

from app.core.exceptions import ValidationException
from app.db.models import User, ScoreInvite, ScoreMembership
from app.db.models.score_access import InviteStatus, MembershipRole
from app.modules.score_invites.rules import hash_invite_token
from app.modules.score_invites.service import ScoreInviteService
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive
from tests.support.postgres_schema import postgres_schema_database
from tests.test_score_revision_services import add_active_score_with_head_revision
from tests.test_performance_takes import AsyncSessionAdapter


@pytest.mark.parametrize(
    "first,second",
    [
        ("revoke", "accept"),
        ("accept", "revoke"),
        ("revoke", "decline"),
        ("decline", "revoke"),
        ("accept", "decline"),
        ("decline", "accept"),
    ],
)
@pytest.mark.parametrize("existing_revoked_membership", [False, True])
def test_invite_terminal_commands_serialize_on_postgres_row(
    monkeypatch, first, second, existing_revoked_membership
):
    outcome = {
        "accept": InviteStatus.ACCEPTED,
        "decline": InviteStatus.DECLINED,
        "revoke": InviteStatus.REVOKED,
    }[first]
    error_code = {
        "accept": ErrorCode.INVITE_ALREADY_ACCEPTED,
        "decline": ErrorCode.INVITE_DECLINED,
        "revoke": ErrorCode.INVITE_REVOKED,
    }[first]
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as setup:
            setup.add_all(
                [
                    User(id=1, email="owner@example.com", password_hash="hash"),
                    User(id=2, email="member@example.com", password_hash="hash"),
                ]
            )
            setup.flush()
            add_active_score_with_head_revision(
                setup,
                score_id=10,
                revision_id=11,
                score_uuid="shared",
                revision_uuid="head",
                title="Shared",
            )
            invite = ScoreInvite(
                invite_uuid="invitation",
                score_id=10,
                email="member@example.com",
                role=MembershipRole.VIEWER,
                token_hash=hash_invite_token("token"),
                created_by_user_id=1,
            )
            setup.add(invite)
            revoked_at = utc_now_naive() - timedelta(days=1)
            if existing_revoked_membership:
                setup.add(
                    ScoreMembership(
                        score_id=10,
                        user_id=2,
                        role=MembershipRole.EDITOR,
                        revoked_at=revoked_at,
                        created_by_user_id=1,
                    )
                )
            setup.commit()
            invite_id = invite.id
        service = ScoreInviteService()

        async def actor_command(db, action):
            if action == "accept":
                await service.accept_invite(db, "token", 2)
            elif action == "decline":
                await service.decline_pending_invite(db, "invitation", 2)
            else:
                await service.revoke_invite(db, "shared", "invitation", 1)

        class HeldCommit(AsyncSessionAdapter):
            async def commit(self):
                self.session.flush()

        ready, result = Queue(), Queue()
        with Session(engine, expire_on_commit=False) as winning:
            asyncio.run(actor_command(HeldCommit(winning), first))
            winning_pid = winning.scalar(text("SELECT pg_backend_pid()"))

            def second_command():
                try:
                    with Session(engine) as db:
                        # Keep a stale identity-map object alive while waiting for the winner.
                        cached = db.get(ScoreInvite, invite_id)
                        assert cached.status == InviteStatus.PENDING
                        ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                        asyncio.run(actor_command(AsyncSessionAdapter(db), second))
                    result.put(None)
                except BaseException as exc:
                    result.put(exc)

            thread = Thread(target=second_command)
            thread.start()
            try:
                waiting_pid = ready.get(timeout=10)
                deadline = monotonic() + 10
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                    while not observer.scalar(
                        text("SELECT :winner = ANY(pg_blocking_pids(:waiting))"),
                        {"winner": winning_pid, "waiting": waiting_pid},
                    ):
                        assert monotonic() < deadline, "Second command must wait on the Invite lock"
                    blocked = observer.execute(
                        text(
                            "SELECT wait_event_type, query FROM pg_stat_activity WHERE pid = :waiting"
                        ),
                        {"waiting": waiting_pid},
                    ).one()
                    assert blocked.wait_event_type == "Lock"
                    assert (
                        "score_invites" in blocked.query.lower()
                        and "for update" in blocked.query.lower()
                    )
                    # Neither the accepted Invite nor its active membership is visible before commit.
                    assert (
                        observer.scalar(
                            select(ScoreInvite.status).where(ScoreInvite.id == invite_id)
                        )
                        == InviteStatus.PENDING
                    )
                    assert (
                        observer.scalar(
                            select(func.count())
                            .select_from(ScoreMembership)
                            .where(ScoreMembership.revoked_at.is_(None))
                        )
                        == 0
                    )
                winning.commit()
            finally:
                winning.rollback()
                thread.join(timeout=10)
            assert not thread.is_alive()
            error = result.get(timeout=1)
            assert isinstance(error, ValidationException) and error.code == error_code
        with Session(engine) as check:
            assert check.get(ScoreInvite, invite_id).status == outcome
            membership = check.scalar(select(ScoreMembership))
            if outcome == InviteStatus.ACCEPTED:
                assert membership is not None and membership.revoked_at is None
                assert membership.role == (
                    MembershipRole.EDITOR if existing_revoked_membership else MembershipRole.VIEWER
                )
            elif existing_revoked_membership:
                assert membership.revoked_at == revoked_at
            else:
                assert membership is None
