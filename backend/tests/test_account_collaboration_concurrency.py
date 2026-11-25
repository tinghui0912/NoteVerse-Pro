"""Independent PostgreSQL transactions prove closure/invitation lock ordering."""

from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from time import monotonic
from datetime import timedelta
import pytest
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session
from app.core.exceptions import ValidationException, ResourceNotFoundException
from app.db.models import (
    User,
    Score,
    ScoreInvite,
    ScoreMembership,
    MailOutbox,
    MailOutboxStatus,
    AccountDeletionOperation,
    AccountDeletionPhase,
    ScoreRevision,
    ScoreRevisionNote,
    ScoreRevisionEvent,
)
from app.db.models.score_access import InviteTerminalOutcome as Outcome, MembershipRole
from app.modules.account.deletion_service import AccountDeletionService
from app.modules.account.deletion_repository import AccountDeletionRepository
from app.modules.account.resource_admission import lock_active_resource_user
from app.modules.account.email_identity import lock_email_identity
from app.modules.account.deletion_delivery import account_deletion_delivery as delivery
from app.composition.account_deletion import AccountDeletionExecutor
from app.modules.storage_inventory.composition import build_storage_inventory_registry
from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.schemas import InviteCreateRequest
from tests.test_account_collaboration_postgres import (
    collaboration_accounts as collaboration_accounts,
    seed_invite,
    close_account,
    drain,
    assert_bob_graph,
)


def wait_for_lock(engine, owner, contender):
    deadline = monotonic() + 10
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
        while not observer.scalar(
            text("SELECT :owner = ANY(pg_blocking_pids(:contender))"),
            {"owner": owner, "contender": contender},
        ):
            assert monotonic() < deadline, "Expected actual PostgreSQL row-lock contention"


@pytest.mark.parametrize("subject", ["recipient", "inviter"])
@pytest.mark.parametrize("command", ["accept", "decline"])
@pytest.mark.parametrize("first", ["closure", "command"])
def test_invitation_response_and_closure_serialize_without_reviving_access(
    collaboration_accounts, subject, command, first
):  # noqa: F811
    engine = collaboration_accounts
    actor = 1 if subject == "recipient" else 3
    with Session(engine) as db:
        row, _, token = seed_invite(
            db,
            creator=2 if subject == "recipient" else 1,
            email="alice@example.com" if subject == "recipient" else "carol@example.com",
        )
        row.role = MembershipRole.VIEWER
        uuid = row.invite_uuid
        db.commit()

    def respond(db):
        if command == "accept":
            return InvitationService().accept_invite(db, token, actor)
        return InvitationService().decline_pending_invite(db, uuid, actor)

    ready = Queue()
    with Session(engine) as owner_db, ThreadPoolExecutor(1) as pool:
        owner = owner_db.scalar(text("SELECT pg_backend_pid()"))
        if first == "closure":
            operation = AccountDeletionService().request_deletion(
                owner_db, 1, current_password="secret123"
            )

            def competing():
                with Session(engine) as db:
                    ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                    with pytest.raises((ValidationException, ResourceNotFoundException)):
                        respond(db)
                    db.rollback()

            future = pool.submit(competing)
        else:
            respond(owner_db)

            def competing():
                with Session(engine) as db:
                    ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                    operation = AccountDeletionService().request_deletion(
                        db, 1, current_password="secret123"
                    )
                    db.commit()
                    return operation

            future = pool.submit(competing)
        try:
            wait_for_lock(engine, owner, ready.get(timeout=10))
        finally:
            owner_db.commit()
        result = future.result(timeout=10)
        if first == "command":
            operation = result
    with Session(engine) as db:
        row = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == uuid))
        if first == "closure":
            assert row.terminal_outcome == (
                Outcome.RECIPIENT_ACCOUNT_CLOSED
                if subject == "recipient"
                else Outcome.INVITER_ACCOUNT_CLOSED
            )
        else:
            assert row.terminal_outcome == (
                Outcome.ACCEPTED if command == "accept" else Outcome.DECLINED
            )
        assert row.email is row.token_hash is None
        assert row.terminal_actor_user_id != (1)
        assert db.scalar(select(MailOutbox)).status == MailOutboxStatus.CANCELLED
        assert not db.get(User, 1).is_active
        assert_bob_graph(db)
    drain(engine, operation)
    with Session(engine) as db:
        assert db.get(User, 1) is None
        assert db.scalar(select(ScoreMembership).where(ScoreMembership.user_id == 1)) is None
        assert_bob_graph(db)


@pytest.mark.parametrize("subject", ["recipient", "inviter"])
def test_finalization_waits_for_pre_admitted_invitation_and_cleans_late_commit(
    collaboration_accounts, subject
):  # noqa: F811
    engine = collaboration_accounts
    ready = Queue()
    with Session(engine) as creator_db, ThreadPoolExecutor(1) as pool:
        owner = creator_db.scalar(text("SELECT pg_backend_pid()"))
        if subject == "recipient":
            created = InvitationService().create_invite(
                creator_db, "bob-score", 2, InviteCreateRequest(email="alice@example.com")
            )
            row = creator_db.scalar(
                select(ScoreInvite).where(ScoreInvite.invite_uuid == created.invite_id)
            )
        else:
            # A previously admitted issuer keeps its own User KEY SHARE capability.
            # Persisted issuer lineage is valid even when the current role matrix no
            # longer grants that principal MANAGE_MEMBERS.
            lock_email_identity(creator_db, "carol@example.com")
            creator_db.scalar(
                select(Score).where(Score.score_uuid == "bob-score").with_for_update()
            )
            lock_active_resource_user(creator_db, 1)
            row, _, _ = seed_invite(creator_db, creator=1, email="carol@example.com")
        row_id = row.id
        if subject == "recipient":
            # Closure must wait even before a recipient row exists: the email
            # namespace precedes assigning either side's authoritative timestamp.
            def close_recipient():
                with Session(engine) as db:
                    ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                    identity = AccountDeletionService().request_deletion(
                        db, 1, current_password="secret123"
                    )
                    db.commit()
                    return identity

            future = pool.submit(close_recipient)
            try:
                wait_for_lock(engine, owner, ready.get(timeout=10))
            finally:
                creator_db.commit()
            operation = future.result(timeout=10)
        else:
            operation = close_account(engine)
        with Session(engine) as db:
            closed_at = db.get(User, 1).deleted_at
            db.scalar(select(AccountDeletionOperation)).phase = AccountDeletionPhase.FINALIZE
            db.commit()
        if subject == "inviter":
            row.created_at = closed_at + timedelta(seconds=1)
            creator_db.flush()
        else:
            assert row.created_at <= closed_at

        def finalize():
            with Session(engine) as db:
                lease = delivery.claim(db, operation)
                db.commit()
                ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                completed = AccountDeletionExecutor(build_storage_inventory_registry()).execute(
                    db, lease
                )
                db.commit()
                return completed

        if subject == "inviter":
            future = pool.submit(finalize)
            try:
                wait_for_lock(engine, owner, ready.get(timeout=10))
            finally:
                creator_db.commit()
            assert not future.result(timeout=10)
    drain(engine, operation)
    with Session(engine) as db:
        row = db.get(ScoreInvite, row_id)
        assert row.terminal_outcome == (
            Outcome.RECIPIENT_ACCOUNT_CLOSED
            if subject == "recipient"
            else Outcome.INVITER_ACCOUNT_CLOSED
        )
        assert row.email is row.token_hash is None
        if subject == "inviter":
            assert row.created_by_user_id is None
        assert db.get(User, 1) is None
        assert_bob_graph(db)


def test_new_invitation_survives_concurrent_final_user_erasure(collaboration_accounts, monkeypatch):  # noqa: F811
    engine = collaboration_accounts
    with Session(engine) as db:
        old, _, old_token = seed_invite(db)
        old_id = old.id
        # This case isolates the final identity unit after earlier attribution units.
        db.execute(update(ScoreRevision).values(created_by_user_id=2))
        db.execute(update(ScoreRevisionNote).values(author_user_id=2))
        db.execute(update(ScoreRevisionEvent).values(actor_user_id=2))
        db.commit()
    operation = close_account(engine)
    with Session(engine) as db:
        db.scalar(select(AccountDeletionOperation)).phase = AccountDeletionPhase.FINALIZE
        lease = delivery.claim(db, operation)
        closed_at = db.get(User, 1).deleted_at
        db.commit()
    ready = Queue()
    with Session(engine) as final_db, ThreadPoolExecutor(1) as pool:
        owner = final_db.scalar(text("SELECT pg_backend_pid()"))
        delivery.require(final_db, lease)
        AccountDeletionRepository().lock_user(final_db, 1, erasure=True)

        def create_new():
            with Session(engine) as db:
                ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                result = InvitationService().create_invite(
                    db, "bob-score", 2, InviteCreateRequest(email="alice@example.com")
                )
                db.commit()
                return result

        future = pool.submit(create_new)
        try:
            wait_for_lock(engine, owner, ready.get(timeout=10))
            assert not AccountDeletionExecutor(build_storage_inventory_registry()).execute(
                final_db, lease
            )
            assert final_db.get(User, 1) is not None
        finally:
            final_db.commit()
        fresh = future.result(timeout=10)
    # Advance only the delivery clock to the persisted busy checkpoint. No sleep,
    # retry-policy change or lock-order workaround is needed.
    import importlib

    delivery_module = importlib.import_module("app.modules.account.deletion_delivery")
    with Session(engine) as db:
        due = db.scalar(select(AccountDeletionOperation.next_attempt_at))
    monkeypatch.setattr(delivery_module, "utc_now", lambda: due + timedelta(seconds=1))
    drain(engine, operation)
    with Session(engine) as db:
        assert db.get(User, 1) is None
        assert db.get(ScoreInvite, old_id).token_hash is None
        row = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == fresh.invite_id))
        assert row.created_at > closed_at and row.token_hash and row.email == "alice@example.com"
        assert row.terminal_outcome is None and fresh.token != old_token
        assert (
            db.scalar(
                select(MailOutbox).where(
                    MailOutbox.source_id == row.id, MailOutbox.source_kind == "SCORE_INVITE"
                )
            ).status
            == MailOutboxStatus.PENDING
        )
        assert_bob_graph(db)


def test_unregistered_invitation_cannot_cross_an_identity_lifetime(
    collaboration_accounts, monkeypatch
):  # noqa: F811
    from app.modules.auth.email_verification_service import EmailVerificationService
    from app.modules.auth.schemas import RegisterRequest, VerifyEmailRequest

    engine = collaboration_accounts
    drain(engine, close_account(engine))
    verification = EmailVerificationService()
    monkeypatch.setattr(verification, "_new_token", lambda: "registered-identity-token")
    ready = Queue()
    with Session(engine) as creator_db, ThreadPoolExecutor(1) as pool:
        owner = creator_db.scalar(text("SELECT pg_backend_pid()"))
        old = InvitationService().create_invite(
            creator_db, "bob-score", 2, InviteCreateRequest(email="alice@example.com")
        )

        def register_then_close():
            with Session(engine) as db:
                ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                verification.register(
                    db,
                    RegisterRequest(
                        email="alice@example.com", password="secret123", display_name="New Alice"
                    ),
                )
                user = verification.verify_email(
                    db, VerifyEmailRequest(token="registered-identity-token")
                )
                user_id = user.id
                identity = AccountDeletionService().request_deletion(
                    db, user_id, current_password="secret123"
                )
                db.commit()
                return user_id, identity

        future = pool.submit(register_then_close)
        try:
            wait_for_lock(engine, owner, ready.get(timeout=10))
        finally:
            creator_db.commit()
        second_user, identity = future.result(timeout=10)
    drain(engine, identity)
    with Session(engine) as db:
        row = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == old.invite_id))
        assert row.terminal_outcome == Outcome.RECIPIENT_ACCOUNT_CLOSED
        assert row.email is row.token_hash is None
        assert (
            db.scalar(
                select(MailOutbox).where(
                    MailOutbox.source_id == row.id, MailOutbox.source_kind == "SCORE_INVITE"
                )
            ).status
            == MailOutboxStatus.CANCELLED
        )
        verification.register(
            db,
            RegisterRequest(
                email="alice@example.com", password="secret123", display_name="Latest Alice"
            ),
        )
        new_user = verification.verify_email(
            db, VerifyEmailRequest(token="registered-identity-token")
        )
        assert new_user.id != second_user and second_user != 1
        with pytest.raises(ResourceNotFoundException):
            InvitationService().accept_invite(db, old.token, new_user.id)
        db.rollback()
        assert (
            db.scalar(select(ScoreMembership).where(ScoreMembership.user_id == new_user.id)) is None
        )
        assert_bob_graph(db)
