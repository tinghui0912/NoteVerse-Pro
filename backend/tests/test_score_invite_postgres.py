"""Invitation commands contend on the current row and preserve the winning terminal state."""

from datetime import timedelta
from queue import Queue
from unittest.mock import patch
from threading import Thread
from time import monotonic

import pytest
from alembic import command
from sqlalchemy import select, text, func
from sqlalchemy.orm import Session

from app.core.exceptions import ValidationException
from app.db.models import User, ScoreInvite, ScoreMembership
from app.db.models.score_access import MembershipRole, InviteTerminalOutcome
from app.modules.score_invites.rules import hash_invite_token
from app.modules.score_invites.service import ScoreInviteService
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive
from tests.support.postgres_schema import postgres_schema_database
from tests.test_score_revision_services import add_active_score_with_head_revision


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
        "accept": InviteTerminalOutcome.ACCEPTED,
        "decline": InviteTerminalOutcome.DECLINED,
        "revoke": InviteTerminalOutcome.REVOKED,
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

        def actor_command(db, action):
            if action == "accept":
                service.accept_invite(db, "token", 2)
            elif action == "decline":
                service.decline_pending_invite(db, "invitation", 2)
            else:
                service.revoke_invite(db, "shared", "invitation", 1)

        ready, result = Queue(), Queue()
        with Session(engine, expire_on_commit=False) as winning:
            with patch.object(winning, "commit", side_effect=winning.flush):
                actor_command(winning, first)
            winning_pid = winning.scalar(text("SELECT pg_backend_pid()"))

            def second_command():
                try:
                    with Session(engine) as db:
                        # Keep a stale identity-map object alive while waiting for the winner.
                        cached = db.get(ScoreInvite, invite_id)
                        assert cached.terminal_outcome is None
                        ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                        actor_command(db, second)
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
                            select(ScoreInvite.terminal_outcome).where(ScoreInvite.id == invite_id)
                        )
                        is None
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
            terminal = check.get(ScoreInvite, invite_id)
            assert terminal.terminal_outcome == outcome
            assert terminal.terminal_at is not None
            assert terminal.terminal_actor_user_id == (1 if first == "revoke" else 2)
            membership = check.scalar(select(ScoreMembership))
            if outcome == InviteTerminalOutcome.ACCEPTED:
                assert membership is not None and membership.revoked_at is None
                assert membership.role == (
                    MembershipRole.EDITOR if existing_revoked_membership else MembershipRole.VIEWER
                )
            elif existing_revoked_membership:
                assert membership.revoked_at == revoked_at
            else:
                assert membership is None


@pytest.mark.parametrize("action", ["accept", "decline"])
@pytest.mark.parametrize("boundary", ["success", "notification", "realtime", "notify", "commit"])
def test_invite_outcome_and_notification_share_one_transaction(monkeypatch, action, boundary):
    from app.db.models import Notification, RealtimeChange
    from app.modules.notifications import service as notification_module
    from app.modules.realtime import publisher

    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
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
            db.commit()
        with Session(engine) as db:
            service = ScoreInviteService()
            if boundary != "success":
                if boundary == "commit":
                    target, name, original = db, "commit", db.flush
                else:
                    target, name = {
                        "notification": (
                            service.notification_service,
                            "admit_score_invite_response",
                        ),
                        "realtime": (notification_module, "publish_change"),
                        "notify": (publisher, "_notify_change"),
                    }[boundary]
                    original = getattr(target, name)

                def fail(*args, **kwargs):
                    original(*args, **kwargs)
                    raise RuntimeError("invite admission interrupted")

                monkeypatch.setattr(target, name, fail)

            def execute():
                if action == "accept":
                    service.accept_invite(db, "token", 2)
                else:
                    service.decline_pending_invite(db, "invitation", 2)

            if boundary == "success":
                execute()
            else:
                with pytest.raises(RuntimeError, match="invite admission interrupted"):
                    execute()
                db.rollback()
        with Session(engine) as db:
            invite = db.scalar(select(ScoreInvite))
            notice = db.scalar(select(Notification))
            realtime = db.scalar(select(RealtimeChange))
            membership = db.scalar(select(ScoreMembership))
            if boundary == "success":
                assert invite.terminal_outcome == (
                    InviteTerminalOutcome.ACCEPTED
                    if action == "accept"
                    else InviteTerminalOutcome.DECLINED
                )
                assert (membership is not None) == (action == "accept")
                assert notice.kind == (
                    "score_invite.accepted" if action == "accept" else "score_invite.declined"
                )
                assert notice.recipient_user_id == 1 and notice.actor_user_id == 2
                assert realtime.kind == "notifications.changed"
                assert realtime.notification_id == notice.notification_uuid
            else:
                assert invite.terminal_outcome is None and membership is None
                assert notice is None and realtime is None
