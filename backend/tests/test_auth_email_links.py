"""Real account email credentials are hashed, expiring and single-use."""

from datetime import timedelta
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import ValidationError as SchemaError
from app.db.models import User, AuthToken, MailOutbox, PendingRegistration, EmailChangeRequest
from app.platform.security.passwords import hash_password, verify_password
from app.platform.security.opaque_tokens import generate_token, token_digest
from app.platform.config.application import AccountEmailConfig
from app.modules.auth.password_reset_service import PasswordResetService
from app.modules.auth.email_verification_service import EmailVerificationService
from app.modules.auth.email_change_service import EmailChangeService
from app.modules.auth.schemas import (
    RegisterRequest,
    ChangePasswordRequest,
    ResetPasswordRequest,
    ForgotPasswordRequest,
    VerifyEmailRequest,
    RequestEmailChangeRequest,
    ConfirmEmailChangeRequest,
)
from app.core.exceptions import ValidationException, ResourceAlreadyExistsException
from app.db.models import MailOutboxStatus
from app.shared.time import utc_now
from tests.support.authentication import session_service
from tests.support.storage_state import provision_storage_users
from app.composition.storage_resources import provision_storage_resources

PASSWORD = "correct-password-123"
CONFIG = AccountEmailConfig(FRONTEND_BASE_URL="https://app.example.test")


@pytest.fixture
def account(postgres_engine):
    with Session(postgres_engine) as db:
        db.add(
            User(
                email="first@example.com",
                display_name="First",
                password_hash=hash_password(PASSWORD),
            )
        )
        db.flush()
        provision_storage_users(db)
        db.commit()
        yield db


@pytest.mark.parametrize(
    "schema,field",
    [
        (RegisterRequest, "password"),
        (ChangePasswordRequest, "new_password"),
        (ResetPasswordRequest, "new_password"),
    ],
)
@pytest.mark.parametrize("password", ["a" * 11, "a" * 129, " " * 12])
def test_password_policy_applies_to_every_credential_admission(schema, field, password):
    values = {
        "email": "new@example.com",
        "display_name": "New",
        "token": "opaque",
        "current_password": PASSWORD,
        field: password,
    }
    with pytest.raises(SchemaError):
        schema(**values)


def test_registration_hashes_password_and_sends_fragment_credential(account, monkeypatch):
    service = EmailVerificationService(provision_storage=provision_storage_resources, config=CONFIG)
    raw = generate_token()
    monkeypatch.setattr(service, "_new_token", lambda: raw)
    service.register(
        account, RegisterRequest(email="new@example.com", display_name="New", password=PASSWORD)
    )
    row = account.scalar(select(PendingRegistration))
    assert row.token_hash == token_digest(raw) and verify_password(PASSWORD, row.password_hash)
    mail = account.scalar(select(MailOutbox))
    assert "#token=" + raw in mail.text_body and "?token=" not in mail.text_body
    result = service.verify_email(account, VerifyEmailRequest(token=raw))
    assert result.email == "new@example.com"
    assert account.scalar(select(PendingRegistration)) is None
    with pytest.raises(ValidationException):
        service.verify_email(account, VerifyEmailRequest(token=raw))


def test_registration_rejects_an_existing_account(account):
    with pytest.raises(ResourceAlreadyExistsException):
        EmailVerificationService(
            provision_storage=provision_storage_resources, config=CONFIG
        ).register(
            account,
            RegisterRequest(email="first@example.com", display_name="First", password=PASSWORD),
        )


def test_registration_resend_replaces_the_credential_and_cancels_its_mail(account):
    service = EmailVerificationService(provision_storage=provision_storage_resources, config=CONFIG)
    request = RegisterRequest(email="new@example.com", display_name="New", password=PASSWORD)
    service.register(account, request)
    pending = account.scalar(select(PendingRegistration))
    first_hash, identity = pending.token_hash, pending.id
    service.register(account, request)
    pending = account.scalar(select(PendingRegistration))
    assert pending.id == identity and pending.token_hash != first_hash
    assert pending.resend_count == 1
    mails = list(account.scalars(select(MailOutbox).order_by(MailOutbox.id)))
    assert [mail.status for mail in mails] == [MailOutboxStatus.CANCELLED, MailOutboxStatus.PENDING]
    assert mails[0].text_body is None and mails[0].recipient == ""


def test_email_change_keeps_its_source_identity_and_fragment_token(account, monkeypatch):
    service = EmailChangeService(config=CONFIG)
    raw = generate_token()
    monkeypatch.setattr(service, "_new_token", lambda: raw)
    service.request_email_change(
        account,
        account.get(User, 1),
        RequestEmailChangeRequest(new_email="changed@example.com", current_password=PASSWORD),
    )
    row = account.scalar(select(EmailChangeRequest))
    assert row.token_hash == token_digest(raw)
    assert "#token=" + raw in account.scalar(select(MailOutbox)).text_body
    result = service.confirm_email_change(account, ConfirmEmailChangeRequest(token=raw))
    assert result.email == "changed@example.com"
    with pytest.raises(ValidationException):
        service.confirm_email_change(account, ConfirmEmailChangeRequest(token=raw))


def test_reset_is_single_use_and_unknown_recipient_is_generic(account, monkeypatch):
    service = PasswordResetService(session_service(), config=CONFIG)
    assert (
        service.request_password_reset(account, ForgotPasswordRequest(email="unknown@example.com"))
        is None
    )
    assert account.scalar(select(MailOutbox)) is None
    raw = generate_token()
    monkeypatch.setattr(service, "_new_token", lambda: raw)
    service.request_password_reset(account, ForgotPasswordRequest(email="first@example.com"))
    assert account.scalar(select(AuthToken)).token_hash == token_digest(raw)
    service.reset_password(
        account, ResetPasswordRequest(token=raw, new_password="new-password-123")
    )
    assert verify_password("new-password-123", account.get(User, 1).password_hash)
    with pytest.raises(ValidationException):
        service.reset_password(
            account, ResetPasswordRequest(token=raw, new_password="next-password-123")
        )


def test_expired_reset_does_not_change_credentials(account, monkeypatch):
    service = PasswordResetService(session_service(), config=CONFIG)
    raw = generate_token()
    monkeypatch.setattr(service, "_new_token", lambda: raw)
    service.request_password_reset(account, ForgotPasswordRequest(email="first@example.com"))
    account.scalar(select(AuthToken)).expires_at = utc_now() - timedelta(seconds=1)
    account.commit()
    with pytest.raises(ValidationException):
        service.reset_password(
            account, ResetPasswordRequest(token=raw, new_password="new-password-123")
        )
    assert verify_password(PASSWORD, account.get(User, 1).password_hash)
