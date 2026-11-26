"""Credential and source-mail lifecycle invariants on independent PostgreSQL sessions."""

from app.composition import storage_resources as _resource_wiring
from app.composition import media_resources as _media_wiring


from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from queue import Queue
from time import monotonic
from urllib.parse import parse_qs, urlsplit
import re

import pytest
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session
from app.core.exceptions import ValidationException
from app.core.security import verify_password
from app.db.models import User, Score, ScoreInvite, MailOutbox, MailOutboxStatus, MembershipRole
from app.db.models.auth import AuthToken, EmailChangeRequest
from app.db.models.mail_outbox import MailSourceKind
from app.modules.account.deletion_service import AccountDeletionService
from app.modules.auth.password_reset_service import PasswordResetService
from app.modules.auth.email_change_service import EmailChangeService
from app.modules.auth.schemas import (
    ForgotPasswordRequest,
    ResetPasswordRequest,
    RequestEmailChangeRequest,
    ConfirmEmailChangeRequest,
)
from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.schemas import InviteCreateRequest
from app.modules.mail.outbox_service import mail_outbox_service, cancel_source_mail
from app.modules.scores.lifecycle_service import ScoreLifecycleService
from app.composition.mail_delivery import validate_mail_source
from app.shared.time import utc_now
from tests.test_account_deletion_postgres import account_database  # noqa: F401


@pytest.fixture
def credential_database(account_database):  # noqa: F811 - imported PostgreSQL fixture
    with Session(account_database) as db:
        db.get(User, 1).email = "closer@example.com"
        db.get(User, 2).email = "survivor@example.com"
        # The imported fixture seeds explicit IDs; normal signup uses the sequence.
        db.execute(
            text("SELECT setval(pg_get_serial_sequence('users','id'), (SELECT max(id) FROM users))")
        )
        db.commit()
    return account_database


def issue_reset(engine):
    with Session(engine) as db:
        PasswordResetService().request_password_reset(
            db, ForgotPasswordRequest(email="closer@example.com", locale="en")
        )
        row = db.scalar(
            select(MailOutbox)
            .where(MailOutbox.category == "password.reset.requested")
            .order_by(MailOutbox.id.desc())
        )
        url = re.search(r"https?://[^\s<>]+", row.text_body).group()
        return parse_qs(urlsplit(url).query)["token"][0]


def close(db, password="secret123"):
    AccountDeletionService().request_deletion(db, 1, current_password=password)


def reset(db, token):
    PasswordResetService().reset_password(
        db, ResetPasswordRequest(token=token, new_password="changed123", locale="en")
    )


def test_closure_invalidates_auth_and_email_tokens_without_erasing_history(credential_database):
    token = issue_reset(credential_database)
    with Session(credential_database) as db:
        EmailChangeService().request_email_change(
            db,
            db.get(User, 1),
            RequestEmailChangeRequest(
                new_email="future@example.com", current_password="secret123", locale="en"
            ),
        )
        close(db)
        db.commit()
    with Session(credential_database) as db:
        assert db.scalar(select(AuthToken)).used_at is not None
        assert db.scalar(select(EmailChangeRequest)).consumed_at is not None
        with pytest.raises(ValidationException):
            reset(db, token)
        db.rollback()
        assert verify_password("secret123", db.get(User, 1).password_hash)
        assert (
            db.scalar(
                select(func.count())
                .select_from(MailOutbox)
                .where(MailOutbox.category == "password.reset.completed")
            )
            == 0
        )
        for row in db.scalars(select(MailOutbox)):
            assert row.status == MailOutboxStatus.CANCELLED
            assert row.recipient == "" and row.subject == ""
            assert row.text_body is None and row.html_body is None


def test_closure_rollback_restores_credentials_and_mail(credential_database):
    token = issue_reset(credential_database)
    with Session(credential_database) as db:
        close(db)
        db.rollback()
    with Session(credential_database) as db:
        assert db.scalar(select(AuthToken)).used_at is None
        assert db.scalar(select(MailOutbox)).status == MailOutboxStatus.PENDING
        reset(db, token)
        assert verify_password("changed123", db.get(User, 1).password_hash)


@pytest.mark.parametrize("inactive,tombstone", [(False, False), (True, True)])
def test_reset_rechecks_user_even_if_token_was_not_revoked(
    credential_database, inactive, tombstone
):
    token = issue_reset(credential_database)
    with Session(credential_database) as db:
        user = db.get(User, 1)
        user.is_active = inactive
        user.deleted_at = utc_now() if tombstone else None
        db.commit()
    with Session(credential_database) as db:
        with pytest.raises(ValidationException):
            reset(db, token)
        db.rollback()
        assert db.scalar(select(AuthToken)).used_at is None
        assert db.scalar(select(func.count()).select_from(MailOutbox)) == 1


def wait_for_lock(engine, owner, contender):
    deadline = monotonic() + 10
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
        while not observer.scalar(
            text("SELECT :owner = ANY(pg_blocking_pids(:contender))"),
            {"owner": owner, "contender": contender},
        ):
            assert monotonic() < deadline, "Expected real PostgreSQL User lock contention"


@pytest.mark.parametrize("command", ["consume", "issue", "email_change"])
def test_closure_serializes_before_authentication_commands(credential_database, command):
    token = issue_reset(credential_database)
    ready = Queue()

    def auth_command():
        with Session(credential_database) as db:
            ready.put(db.scalar(text("SELECT pg_backend_pid()")))
            if command == "consume":
                with pytest.raises(ValidationException):
                    reset(db, token)
            elif command == "email_change":
                with pytest.raises(ValidationException):
                    EmailChangeService().request_email_change(
                        db,
                        db.get(User, 1),
                        RequestEmailChangeRequest(
                            new_email="new@example.com", current_password="secret123", locale="en"
                        ),
                    )
            else:
                PasswordResetService().request_password_reset(
                    db, ForgotPasswordRequest(email="closer@example.com", locale="en")
                )

    with Session(credential_database) as closing, ThreadPoolExecutor(1) as pool:
        owner = closing.scalar(text("SELECT pg_backend_pid()"))
        close(closing)
        future = pool.submit(auth_command)
        try:
            wait_for_lock(credential_database, owner, ready.get(timeout=10))
        finally:
            closing.commit()
        future.result(timeout=10)
    with Session(credential_database) as db:
        assert db.scalar(select(func.count()).select_from(AuthToken)) == 1
        assert db.scalar(select(func.count()).select_from(EmailChangeRequest)) == 0
        assert verify_password("secret123", db.get(User, 1).password_hash)


def test_password_reset_commits_before_closure_and_its_notice_is_cancelled(credential_database):
    token = issue_reset(credential_database)
    ready = Queue()

    def closure():
        with Session(credential_database) as db:
            ready.put(db.scalar(text("SELECT pg_backend_pid()")))
            close(db, "changed123")
            db.commit()

    with Session(credential_database) as resetting, ThreadPoolExecutor(1) as pool:
        owner = resetting.scalar(text("SELECT pg_backend_pid()"))
        resetting.execute(select(User).where(User.id == 1).with_for_update())
        future = pool.submit(closure)
        try:
            wait_for_lock(credential_database, owner, ready.get(timeout=10))
            reset(resetting, token)
        finally:
            resetting.rollback()
        future.result(timeout=10)
    with Session(credential_database) as db:
        assert db.get(User, 1).deleted_at is not None
        notice = db.scalar(
            select(MailOutbox).where(MailOutbox.category == "password.reset.completed")
        )
        assert notice.status == MailOutboxStatus.CANCELLED and notice.text_body is None


def invite(db, owner=1, recipient="recipient@example.com", score_uuid="mail-score"):
    score = Score(score_uuid=score_uuid, owner_user_id=owner, display_title="Private score")
    db.add(score)
    db.flush()
    created = InvitationService().create_invite(
        db, score_uuid, owner, InviteCreateRequest(email=recipient, role=MembershipRole.VIEWER)
    )
    db.flush()
    row = db.scalar(
        select(MailOutbox).where(MailOutbox.dedupe_key == "score-invite:" + created.invite_id)
    )
    return score, created, row


@pytest.mark.parametrize(
    "status",
    [
        MailOutboxStatus.PENDING,
        MailOutboxStatus.DISPATCHED,
        MailOutboxStatus.PROCESSING,
        MailOutboxStatus.FAILED,
        MailOutboxStatus.SENT,
        MailOutboxStatus.EXPIRED,
        MailOutboxStatus.PERMANENT_FAILURE,
    ],
)
def test_score_tombstone_cancels_only_its_invitation_sources(credential_database, status):
    with Session(credential_database) as db:
        score, _, mail = invite(db)
        _, _, foreign = invite(db, owner=2, score_uuid="surviving-score")
        mail.status = status
        mail.attempt_token = "attempt" if status == MailOutboxStatus.PROCESSING else None
        mail.attempt_count = 1
        uuid, foreign_uuid = mail.outbox_uuid, foreign.outbox_uuid
        db.commit()
        ScoreLifecycleService(
            deletion_executor=_media_wiring.build_score_deletion_executor()
        ).admit_deletions(db, [score.score_uuid], 1)
        db.commit()
    with Session(credential_database) as db:
        mail = db.scalar(select(MailOutbox).where(MailOutbox.outbox_uuid == uuid))
        expected = (
            MailOutboxStatus.CANCELLED
            if status
            in {
                MailOutboxStatus.PENDING,
                MailOutboxStatus.DISPATCHED,
                MailOutboxStatus.PROCESSING,
                MailOutboxStatus.FAILED,
            }
            else status
        )
        assert mail.status == expected
        assert mail.recipient == "" and mail.text_body is None and mail.html_body is None
        assert mail.attempt_token is None and mail.attempt_count == 1
        foreign = db.scalar(select(MailOutbox).where(MailOutbox.outbox_uuid == foreign_uuid))
        assert (
            foreign.status == MailOutboxStatus.PENDING
            and foreign.recipient == "recipient@example.com"
        )
        assert not validate_mail_source(db, uuid)
        assert mail_outbox_service.claim(db, uuid) is None


def test_source_invalidation_rolls_back_with_score_tombstone(credential_database):
    with Session(credential_database) as db:
        score, _, mail = invite(db)
        uuid = mail.outbox_uuid
        db.commit()
        ScoreLifecycleService(
            deletion_executor=_media_wiring.build_score_deletion_executor()
        ).admit_deletions(db, [score.score_uuid], 1)
        db.rollback()
        assert db.get(Score, score.id).deleted_at is None
        assert db.scalar(select(MailOutbox).where(MailOutbox.outbox_uuid == uuid)).text_body
        assert validate_mail_source(db, uuid)


def test_claimed_payload_is_fenced_before_provider_send_and_stale_completion(credential_database):
    token = issue_reset(credential_database)
    with Session(credential_database) as db:
        row = db.scalar(select(MailOutbox))
        uuid = row.outbox_uuid
        payload = mail_outbox_service.claim(db, uuid)
        db.commit()
    with Session(credential_database) as db:
        close(db)
        db.commit()
    with Session(credential_database) as db:
        assert not validate_mail_source(db, uuid)
        assert not mail_outbox_service.delivery_permitted(db, uuid, lease=payload.lease)
        assert not mail_outbox_service.sent(db, uuid, "late-provider", lease=payload.lease)
        with pytest.raises(ValidationException):
            mail_outbox_service.rearm_for_operator(db, uuid)
        db.rollback()
        with pytest.raises(ValidationException):
            reset(db, token)


def test_invite_terminal_and_token_consumption_cancel_credential_mail(credential_database):
    with Session(credential_database) as db:
        score, created, row = invite(db, recipient="survivor@example.com")
        uuid = row.outbox_uuid
        db.commit()
        InvitationService().accept_invite(db, created.token, 2)
        db.commit()
        db.expire_all()
        assert (
            db.scalar(select(MailOutbox).where(MailOutbox.outbox_uuid == uuid)).status
            == MailOutboxStatus.CANCELLED
        )
    token = issue_reset(credential_database)
    with Session(credential_database) as db:
        reset(db, token)
        assert (
            db.scalar(
                select(MailOutbox).where(MailOutbox.category == "password.reset.requested")
            ).status
            == MailOutboxStatus.CANCELLED
        )


def test_closure_anonymizes_old_recipient_contact_without_erasing_foreign_score(
    credential_database,
):
    with Session(credential_database) as db:
        _, _, row = invite(
            db, owner=2, recipient="closer@example.com", score_uuid="foreign-contact"
        )
        uuid = row.outbox_uuid
        db.commit()
        close(db)
        db.commit()
        db.expire_all()
        assert db.scalar(select(ScoreInvite)).email is None
        assert db.scalar(select(Score).where(Score.score_uuid == "foreign-contact")) is not None
        row = db.scalar(select(MailOutbox).where(MailOutbox.outbox_uuid == uuid))
        assert row.status == MailOutboxStatus.CANCELLED
        assert not validate_mail_source(db, uuid)


def test_expiry_and_cancelled_mail_retention(credential_database, monkeypatch):
    from app.core.config import settings

    issue_reset(credential_database)
    with Session(credential_database) as db:
        row = db.scalar(select(MailOutbox))
        row.expires_at = utc_now() - timedelta(seconds=1)
        uuid = row.outbox_uuid
        db.commit()
        assert mail_outbox_service.claim(db, uuid) is None
        db.commit()
        assert db.get(MailOutbox, row.id).status == MailOutboxStatus.EXPIRED
        assert row.text_body is None
        cancel_source_mail(db, MailSourceKind.AUTH_TOKEN, select(AuthToken.id))
        row.completed_at = utc_now() - timedelta(days=settings.MAIL_OUTBOX_RETENTION_DAYS + 1)
        db.commit()
        assert mail_outbox_service.cleanup(db) == 1
        db.commit()


def test_email_change_token_cannot_change_closed_identity(credential_database):
    with Session(credential_database) as db:
        EmailChangeService().request_email_change(
            db,
            db.get(User, 1),
            RequestEmailChangeRequest(
                new_email="future@example.com", current_password="secret123", locale="en"
            ),
        )
        row = db.scalar(select(MailOutbox))
        token = parse_qs(urlsplit(re.search(r"https?://[^\s<>]+", row.text_body).group()).query)[
            "token"
        ][0]
        close(db)
        db.commit()
    with Session(credential_database) as db:
        with pytest.raises(ValidationException):
            EmailChangeService().confirm_email_change(db, ConfirmEmailChangeRequest(token=token))
        db.rollback()
        assert db.get(User, 1).email == "closer@example.com"
        assert (
            db.scalar(
                select(func.count())
                .select_from(MailOutbox)
                .where(MailOutbox.category == "email.change.completed")
            )
            == 0
        )


@pytest.mark.parametrize("close_at_handoff", [False, True])
def test_real_mail_worker_never_sends_invalid_source(
    credential_database, monkeypatch, close_at_handoff
):
    from unittest.mock import Mock
    from sqlalchemy.orm import sessionmaker
    from app.worker.execution import mail_outbox as worker

    issue_reset(credential_database)
    with Session(credential_database) as db:
        uuid = db.scalar(select(MailOutbox.outbox_uuid))
    factory = sessionmaker(credential_database)
    monkeypatch.setattr(worker, "SessionLocal", factory)
    provider = Mock(return_value="provider")
    monkeypatch.setattr(worker, "send_email", provider)
    if close_at_handoff:
        start_trace = worker.start_attempt_trace

        def close_between_claim_and_provider(**kwargs):
            with Session(credential_database) as db:
                close(db)
                db.commit()
            return start_trace(**kwargs)

        monkeypatch.setattr(worker, "start_attempt_trace", close_between_claim_and_provider)
    else:
        with Session(credential_database) as db:
            close(db)
            db.commit()
    result = worker.execute_mail_outbox_task(None, uuid)
    assert result["status"] in {"ignored", "stale"}
    provider.assert_not_called()
    with Session(credential_database) as db:
        row = db.scalar(select(MailOutbox))
        assert row.status == MailOutboxStatus.CANCELLED and row.attempt_token is None


def test_mail_worker_detects_source_admitted_after_closure_scan(credential_database, monkeypatch):
    from unittest.mock import Mock
    from sqlalchemy.orm import sessionmaker
    from app.worker.execution import mail_outbox as worker

    with Session(credential_database) as db:
        close(db)
        db.commit()
        # A pre-admitted business transaction may finish after the closure scan.
        # Its source identity still makes this post-closure delivery invalid.
        row = MailOutbox(
            source_kind="ACCOUNT",
            source_id=1,
            category="password.changed",
            dedupe_key="pre-admitted",
            recipient="closer@example.com",
            subject="Changed",
            text_body="Private notice",
        )
        db.add(row)
        db.commit()
        uuid = row.outbox_uuid
    monkeypatch.setattr(worker, "SessionLocal", sessionmaker(credential_database))
    provider = Mock()
    monkeypatch.setattr(worker, "send_email", provider)
    assert worker.execute_mail_outbox_task(None, uuid)["status"] == "ignored"
    provider.assert_not_called()
    with Session(credential_database) as db:
        row = db.scalar(select(MailOutbox))
        assert row.status == MailOutboxStatus.CANCELLED and row.recipient == ""


@pytest.mark.parametrize("outcome", ["revoke", "decline"])
def test_invite_terminal_command_cancels_mail_atomically(credential_database, outcome):
    with Session(credential_database) as db:
        _, created, row = invite(db, recipient="survivor@example.com")
        uuid = row.outbox_uuid
        db.commit()
        if outcome == "revoke":
            InvitationService().revoke_invite(db, "mail-score", created.invite_id, 1)
        else:
            InvitationService().decline_pending_invite(db, created.invite_id, 2)
        db.commit()
        db.expire_all()
        row = db.scalar(select(MailOutbox).where(MailOutbox.outbox_uuid == uuid))
        assert row.status == MailOutboxStatus.CANCELLED
        assert row.recipient == "" and row.text_body is None


@pytest.mark.parametrize(
    "kind,identity", [(None, None), ("ACCOUNT", None), (None, 1), ("OTHER", 1), ("ACCOUNT", 0)]
)
def test_active_mail_requires_valid_complete_source_identity(credential_database, kind, identity):
    from sqlalchemy.exc import IntegrityError

    with Session(credential_database) as db:
        db.add(
            MailOutbox(
                source_kind=kind,
                source_id=identity,
                category="test",
                dedupe_key="invalid",
                recipient="private@example.com",
                subject="Test",
                text_body="Body",
            )
        )
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()
        assert db.scalar(select(func.count()).select_from(MailOutbox)) == 0


def test_cancelled_mail_is_terminal_in_ops_and_retention(credential_database):
    from app.core.config import settings
    from app.modules.ops.query_service import OpsAsyncOperationQueryService
    from app.modules.ops.schemas import AsyncOperationKind, AsyncOperationStatus

    issue_reset(credential_database)
    with Session(credential_database) as db:
        close(db)
        db.commit()
        row = db.scalar(select(MailOutbox))
        query = OpsAsyncOperationQueryService()
        view = query.get_operation(db, kind=AsyncOperationKind.MAIL, operation_id=row.outbox_uuid)
        assert view.status == AsyncOperationStatus.CANCELLED and not view.can_retry
        assert (
            query.list_operations(
                db, kind=AsyncOperationKind.MAIL, status=AsyncOperationStatus.CANCELLED, limit=10
            )
            .items[0]
            .operation_id
            == row.outbox_uuid
        )
        row.completed_at = utc_now() - timedelta(days=settings.MAIL_OUTBOX_RETENTION_DAYS + 1)
        db.commit()
        assert mail_outbox_service.cleanup(db) == 1
        db.commit()
        assert db.scalar(select(func.count()).select_from(MailOutbox)) == 0


def test_mail_dedupe_preserves_source_identity(credential_database):
    from app.modules.mail.outbox_service import queue_mail

    with Session(credential_database) as db:
        args = dict(
            source_kind=MailSourceKind.ACCOUNT,
            source_id=1,
            category="password.changed",
            dedupe_key="same-command",
            recipient="closer@example.com",
            subject="Changed",
            text_body="Notice",
            html_body=None,
        )
        first = queue_mail(db, **args)
        assert queue_mail(db, **args).id == first.id
        with pytest.raises(ValueError, match="another source"):
            queue_mail(db, **{**args, "source_id": 2})
        db.commit()
        assert db.scalar(select(func.count()).select_from(MailOutbox)) == 1


def test_registration_mail_follows_replacement_verification_and_ttl(credential_database):
    from app.modules.auth.email_verification_service import EmailVerificationService
    from app.modules.auth.schemas import RegisterRequest, VerifyEmailRequest
    from app.db.models.auth import PendingRegistration

    registration = RegisterRequest(
        email="applicant@example.com", password="secret123", display_name="Applicant", locale="en"
    )
    with Session(credential_database) as db:
        service = EmailVerificationService(
            provision_storage=_resource_wiring.provision_storage_resources
        )
        service.register(db, registration)
        first = db.scalar(select(MailOutbox))
        first_id = first.id
        service.register(db, registration)
        db.expire_all()
        assert db.get(MailOutbox, first_id).status == MailOutboxStatus.CANCELLED
        assert db.get(MailOutbox, first_id).recipient == ""
        active = db.scalar(select(MailOutbox).where(MailOutbox.status == MailOutboxStatus.PENDING))
        uuid = active.outbox_uuid
        token = parse_qs(urlsplit(re.search(r"https?://[^\s<>]+", active.text_body).group()).query)[
            "token"
        ][0]
        assert validate_mail_source(db, uuid)
        user = service.verify_email(db, VerifyEmailRequest(token=token))
        assert user.email == registration.email
        assert db.scalar(select(PendingRegistration)) is None
        db.expire_all()
        assert (
            db.scalar(select(MailOutbox).where(MailOutbox.outbox_uuid == uuid)).status
            == MailOutboxStatus.CANCELLED
        )
        assert not validate_mail_source(db, uuid)
        service.register(
            db,
            RegisterRequest(
                email="expired@example.com",
                password="secret123",
                display_name="Expired",
                locale="en",
            ),
        )
        pending = db.scalar(select(PendingRegistration))
        pending.expires_at = utc_now() - timedelta(seconds=1)
        db.commit()
        expired = db.scalar(select(MailOutbox).where(MailOutbox.status == MailOutboxStatus.PENDING))
        assert not validate_mail_source(db, expired.outbox_uuid)
        db.commit()
        db.refresh(expired)
        assert expired.status == MailOutboxStatus.CANCELLED and expired.text_body is None


@pytest.mark.parametrize("command", ["lock", "issue"])
def test_credential_mutation_fence_coexists_with_existing_resource_key_share(
    credential_database, command
):
    from app.modules.auth.credential_lifecycle import lock_credential_user

    # An already-admitted resource transaction must not block credential/closure
    # serialization just because its FK retains a User KEY SHARE lock.
    with Session(credential_database) as resource, Session(credential_database) as credential:
        resource.execute(
            select(User).where(User.id == 1).with_for_update(read=True, key_share=True)
        )
        credential.execute(text("SET LOCAL lock_timeout='1s'"))
        if command == "lock":
            assert lock_credential_user(credential, 1).id == 1
        else:
            PasswordResetService().request_password_reset(
                credential, ForgotPasswordRequest(email="closer@example.com", locale="en")
            )
        credential.rollback()
        resource.rollback()


def test_batch_score_tombstones_cancel_complete_invitation_set(credential_database):
    with Session(credential_database) as db:
        owned_ids = []
        for n in (1, 2):
            _, _, row = invite(db, score_uuid=f"owned-mail-{n}")
            owned_ids.append(row.outbox_uuid)
        _, _, foreign = invite(db, owner=2, score_uuid="foreign-mail")
        foreign_id = foreign.outbox_uuid
        db.commit()
        assert (
            len(
                ScoreLifecycleService(
                    deletion_executor=_media_wiring.build_score_deletion_executor()
                ).admit_deletions(db, ["owned-mail-2", "owned-mail-1"], 1)
            )
            == 2
        )
        db.commit()
        db.expire_all()
        for row in db.scalars(select(MailOutbox)):
            if row.outbox_uuid in owned_ids:
                assert row.status == MailOutboxStatus.CANCELLED and row.text_body is None
            else:
                assert row.outbox_uuid == foreign_id
                assert row.status == MailOutboxStatus.PENDING and row.text_body
