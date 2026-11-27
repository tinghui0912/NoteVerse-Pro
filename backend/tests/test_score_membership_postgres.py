"""Membership mutations serialize on the current PostgreSQL row, including cached reads."""

from queue import Queue
from threading import Thread
from time import monotonic

import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.models import User, ScoreMembership, ScoreInvite
from app.db.models.score_access import MembershipRole
from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.membership_service import MembershipService
from app.modules.collaboration.schemas import MemberUpdateRequest
from app.core.exceptions import ValidationException
from app.modules.collaboration.invite_lifecycle import hash_invite_token
from tests.support.postgres_schema import postgres_schema_database
from tests.test_score_revision_services import add_active_score_with_head_revision
from app.platform.config.application import InvitationConfig
from app.runtime.customer_api.context import get_context


@pytest.mark.parametrize(
    "first,second,revoked",
    [
        ("leave", "accept", False),
        ("accept", "leave", True),
        ("remove", "leave", True),
        ("leave", "remove", True),
        ("leave", "update", True),
    ],
)
def test_membership_lifecycle_serializes_after_locked_reread(monkeypatch, first, second, revoked):
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
            member = ScoreMembership(
                score_id=10, user_id=2, role=MembershipRole.VIEWER, created_by_user_id=1
            )
            setup.add(member)
            setup.add(
                ScoreInvite(
                    score_id=10,
                    email="member@example.com",
                    role=MembershipRole.EDITOR,
                    token_hash=hash_invite_token("new-invite"),
                    created_by_user_id=1,
                )
            )
            setup.commit()
            member_id = member.id
        invitations = InvitationService(
            config=InvitationConfig.model_validate(get_context().settings.model_dump())
        )
        service = MembershipService()

        def command_for(db, action):
            if action == "leave":
                service.leave_score(db, "shared", 2)
            elif action == "remove":
                service.remove_member(db, "shared", member_id, 1)
            elif action == "update":
                service.update_member(
                    db, "shared", member_id, 1, MemberUpdateRequest(role=MembershipRole.EDITOR)
                )
            else:
                invitations.accept_invite(db, "new-invite", 2)

        # Keep the first command's actual mutation/row lock open until contention is observed.

        ready, result = Queue(), Queue()
        with Session(engine, expire_on_commit=False) as first_session:
            command_for(first_session, first)
            first_revoked_at = first_session.get(ScoreMembership, member_id).revoked_at
            first_pid = first_session.scalar(text("SELECT pg_backend_pid()"))

            def run_second():
                try:
                    with Session(engine) as db:
                        # Deliberately cache the committed row before the first command commits.
                        cached = db.get(ScoreMembership, member_id)
                        assert cached.revoked_at is None
                        ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                        command_for(db, second)
                        db.commit()
                    result.put(None)
                except BaseException as exc:
                    result.put(exc)

            thread = Thread(target=run_second)
            thread.start()
            try:
                second_pid = ready.get(timeout=10)
                deadline = monotonic() + 10
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                    while not observer.scalar(
                        text("SELECT :first = ANY(pg_blocking_pids(:second))"),
                        {"first": first_pid, "second": second_pid},
                    ):
                        assert monotonic() < deadline, (
                            "Membership mutation must wait on the current row lock"
                        )
                first_session.commit()
            finally:
                first_session.rollback()
                thread.join(timeout=10)
            assert not thread.is_alive()
            error = result.get(timeout=1)
            if second == "update":
                assert isinstance(error, ValidationException)
                assert error.details == {"field": "membership_id"}
            else:
                assert error is None
        with Session(engine) as check:
            current = check.get(ScoreMembership, member_id)
            assert (current.revoked_at is not None) == revoked
            if first in {"leave", "remove"} and second != "accept":
                assert current.revoked_at == first_revoked_at
            if "accept" in {first, second}:
                assert current.role == MembershipRole.EDITOR
