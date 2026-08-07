from __future__ import annotations

from datetime import timedelta

import pytest

from app.core import security
from app.core.config import settings
from app.core.exceptions import ResourceAlreadyExistsException, ValidationException
from app.db.models.auth import AuthToken, EmailChangeRequest, PendingRegistration, RefreshToken
from app.db.models.user import User
from app.modules.auth.email_change_service import EmailChangeService
from app.modules.auth.email_verification_service import EmailVerificationService
from app.modules.auth.password_reset_service import PasswordResetService
from app.modules.auth.password_service import PasswordService
from app.modules.auth.security_service import SecurityService
from app.modules.auth.schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ConfirmEmailChangeRequest,
    RegisterRequest,
    RequestEmailChangeRequest,
    ResetPasswordRequest,
    User as CustomerUserSchema,
    VerifyEmailRequest,
)
from app.modules.auth.sessions_service import SessionService
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class FakeResult:
    def __init__(self, rows: list[object]) -> None:
        self.rows = rows

    def one_or_none(self):
        return self.rows[0] if self.rows else None

    def one(self):
        if len(self.rows) != 1:
            raise AssertionError(f"Expected one row, got {len(self.rows)}")
        return self.rows[0]

    def all(self):
        return self.rows


class FakeDb:
    def __init__(self) -> None:
        self.users: list[User] = []
        self.auth_tokens: list[AuthToken] = []
        self.email_change_requests: list[EmailChangeRequest] = []
        self.pending_registrations: list[PendingRegistration] = []
        self.refresh_tokens: list[RefreshToken] = []
        self.commits = 0
        self.rollbacks = 0
        self._next_id = 1

    def add(self, record) -> None:
        if getattr(record, "id", None) is None:
            record.id = self._next_id
            self._next_id += 1
        if isinstance(record, User):
            self.users.append(record)
        elif isinstance(record, AuthToken):
            self.auth_tokens.append(record)
        elif isinstance(record, EmailChangeRequest):
            self.email_change_requests.append(record)
        elif isinstance(record, PendingRegistration):
            self.pending_registrations.append(record)
        elif isinstance(record, RefreshToken):
            self.refresh_tokens.append(record)

    async def delete(self, record) -> None:
        if isinstance(record, PendingRegistration):
            self.pending_registrations = [
                pending for pending in self.pending_registrations if pending is not record
            ]

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    async def refresh(self, _record) -> None:
        return None

    async def exec(self, statement):
        entity = statement.column_descriptions[0].get("entity")
        if entity is User:
            return FakeResult(self.users)
        if entity is AuthToken:
            return FakeResult(self.auth_tokens)
        if entity is EmailChangeRequest:
            return FakeResult(self.email_change_requests)
        if entity is PendingRegistration:
            return FakeResult(self.pending_registrations)
        if entity is RefreshToken:
            return FakeResult(self.refresh_tokens)
        return FakeResult([])


@pytest.fixture
def verification_queued_mail(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    queued: list[dict[str, object]] = []

    async def capture_mail(_db, **kwargs) -> None:
        queued.append(kwargs)

    monkeypatch.setattr("app.modules.auth.email_verification_service.queue_mail", capture_mail)
    return queued


@pytest.fixture
def auth_queued_mail(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    queued: list[dict[str, object]] = []

    async def capture_mail(_db, **kwargs) -> None:
        queued.append(kwargs)

    monkeypatch.setattr("app.modules.auth.password_reset_service.queue_mail", capture_mail)
    return queued


@pytest.fixture
def email_change_queued_mail(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    queued: list[dict[str, object]] = []

    async def capture_mail(_db, **kwargs) -> None:
        queued.append(kwargs)

    monkeypatch.setattr("app.modules.auth.email_change_service.queue_mail", capture_mail)
    return queued


@pytest.mark.asyncio
async def test_register_creates_pending_registration_and_sends_verification_link(
    verification_queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    service = EmailVerificationService()

    await service.register(
        db,  # type: ignore[arg-type]
        RegisterRequest(
            email="User@Example.com",
            password="secret123",
            display_name="User",
            locale="en",
        ),
    )

    assert db.users == []
    assert db.pending_registrations[0].email == "user@example.com"
    assert db.pending_registrations[0].consumed_at is None
    assert verification_queued_mail[0]["recipient"] == "user@example.com"
    assert "/auth/verify-email?token=" in str(verification_queued_mail[0]["text_body"])


@pytest.mark.asyncio
async def test_register_refreshes_existing_pending_registration(
    verification_queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    service = EmailVerificationService()
    await service.register(
        db,  # type: ignore[arg-type]
        RegisterRequest(
            email="user@example.com",
            password="secret123",
            display_name="User",
            locale="en",
        ),
    )
    first_token_hash = db.pending_registrations[0].token_hash

    await service.register(
        db,  # type: ignore[arg-type]
        RegisterRequest(
            email="user@example.com",
            password="new-secret",
            display_name="New User",
            locale="en",
        ),
    )

    assert len(db.pending_registrations) == 1
    assert db.pending_registrations[0].token_hash != first_token_hash
    assert db.pending_registrations[0].display_name == "New User"
    assert db.pending_registrations[0].resend_count == 1
    assert len(verification_queued_mail) == 2


@pytest.mark.asyncio
async def test_verify_email_creates_user_and_removes_pending_registration(
    verification_queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    service = EmailVerificationService()
    token = service._new_token()
    db.add(
        PendingRegistration(
            email="user@example.com",
            display_name="User",
            password_hash=security.get_password_hash("secret123"),
            token_hash=service._hash_token(token),
            expires_at=utc_now_naive() + timedelta(minutes=10),
        )
    )

    user = await service.verify_email(
        db,  # type: ignore[arg-type]
        VerifyEmailRequest(token=token),
    )

    assert user.email == "user@example.com"
    assert user.email_verified_at is not None
    assert "role" not in CustomerUserSchema.model_validate(user).model_dump()
    assert len(db.users) == 1
    assert db.pending_registrations == []


@pytest.mark.asyncio
async def test_register_rejects_existing_verified_user() -> None:
    db = FakeDb()
    db.add(
        User(
            email="user@example.com",
            display_name="User",
            password_hash=security.get_password_hash("secret123"),
            is_active=True,
        )
    )
    service = EmailVerificationService()

    with pytest.raises(ResourceAlreadyExistsException):
        await service.register(
            db,  # type: ignore[arg-type]
            RegisterRequest(
                email="user@example.com",
                password="secret123",
                display_name="User",
                locale="en",
            ),
        )


@pytest.mark.asyncio
async def test_request_email_change_creates_request_and_sends_confirmation_link(
    email_change_queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    user = User(
        email="old@example.com",
        display_name="User",
        password_hash=security.get_password_hash("current-password"),
        is_active=True,
        email_verified_at=utc_now_naive(),
    )
    db.add(user)

    await EmailChangeService().request_email_change(
        db,  # type: ignore[arg-type]
        user,
        RequestEmailChangeRequest(
            new_email="New@Example.com",
            current_password="current-password",
            locale="en",
        ),
    )

    assert db.email_change_requests[0].new_email == "new@example.com"
    assert db.email_change_requests[0].locale == "en"
    assert db.email_change_requests[0].consumed_at is None
    assert email_change_queued_mail[0]["recipient"] == "new@example.com"
    assert "/auth/confirm-email-change?token=" in str(email_change_queued_mail[0]["text_body"])
    assert db.commits == 1


@pytest.mark.asyncio
async def test_confirm_email_change_updates_user_and_consumes_request(
    email_change_queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    service = EmailChangeService()
    token = service._new_token()
    user = User(
        email="old@example.com",
        display_name="User",
        password_hash=security.get_password_hash("current-password"),
        is_active=True,
        email_verified_at=utc_now_naive() - timedelta(days=1),
    )
    db.add(user)
    db.add(
        EmailChangeRequest(
            user_id=user.id,
            new_email="new@example.com",
            token_hash=service._hash_token(token),
            locale="en",
            expires_at=utc_now_naive() + timedelta(minutes=10),
        )
    )

    updated_user = await service.confirm_email_change(
        db,  # type: ignore[arg-type]
        ConfirmEmailChangeRequest(token=token),
    )

    assert updated_user.email == "new@example.com"
    assert db.email_change_requests[0].consumed_at is not None
    assert email_change_queued_mail[0]["category"] == "email.change.completed"
    assert email_change_queued_mail[0]["recipient"] == "old@example.com"
    assert db.commits == 1


@pytest.mark.asyncio
async def test_password_reset_request_is_generic_for_unknown_email(
    auth_queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    service = PasswordResetService()

    await service.request_password_reset(
        db,  # type: ignore[arg-type]
        ForgotPasswordRequest(email="missing@example.com", locale="en"),
    )

    assert auth_queued_mail == []
    assert db.auth_tokens == []


@pytest.mark.asyncio
async def test_password_reset_token_is_single_use(
    auth_queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    user = User(
        email="user@example.com",
        display_name="User",
        password_hash=security.get_password_hash("old-password"),
        is_active=True,
        email_verified_at=utc_now_naive(),
    )
    db.add(user)

    service = PasswordResetService()
    token = await service._create_token(
        db,  # type: ignore[arg-type]
        user.id,
        ttl_seconds=settings.EMAIL_PASSWORD_RESET_TOKEN_TTL_SECONDS,
    )

    await service.reset_password(
        db,  # type: ignore[arg-type]
        ResetPasswordRequest(new_password="new-password", token=token, locale="en"),
    )

    assert security.verify_password("new-password", user.password_hash)
    assert db.auth_tokens[0].used_at is not None

    with pytest.raises(ValidationException) as exc:
        await service.reset_password(
            db,  # type: ignore[arg-type]
            ResetPasswordRequest(new_password="newer-password", token=token, locale="en"),
        )

    assert exc.value.code == ErrorCode.RESET_TOKEN_INVALID


@pytest.mark.asyncio
async def test_expired_password_reset_token_is_rejected(
    auth_queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    user = User(
        email="user@example.com",
        display_name="User",
        password_hash=security.get_password_hash("old-password"),
        is_active=True,
        email_verified_at=utc_now_naive(),
    )
    db.add(user)

    service = PasswordResetService()
    token = await service._create_token(
        db,  # type: ignore[arg-type]
        user.id,
        ttl_seconds=settings.EMAIL_PASSWORD_RESET_TOKEN_TTL_SECONDS,
    )
    db.auth_tokens[0].expires_at = utc_now_naive() - timedelta(seconds=1)

    with pytest.raises(ValidationException) as exc:
        await service.reset_password(
            db,  # type: ignore[arg-type]
            ResetPasswordRequest(new_password="new-password", token=token, locale="en"),
        )

    assert exc.value.code == ErrorCode.RESET_TOKEN_INVALID


@pytest.mark.asyncio
async def test_current_user_password_change_revokes_sessions_and_sends_notice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queued: list[dict[str, object]] = []

    async def capture_mail(_db, **kwargs) -> None:
        queued.append(kwargs)

    monkeypatch.setattr("app.modules.auth.password_service.queue_mail", capture_mail)

    db = FakeDb()
    user = User(
        email="user@example.com",
        display_name="User",
        password_hash=security.get_password_hash("old-password"),
        is_active=True,
        email_verified_at=utc_now_naive(),
    )
    db.add(user)
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash="refresh-token-hash",
            expires_at=utc_now_naive() + timedelta(days=1),
        )
    )

    await PasswordService().change_current_user_password(
        db,  # type: ignore[arg-type]
        user,
        ChangePasswordRequest(
            current_password="old-password",
            new_password="new-password",
            locale="en",
        ),
    )

    assert security.verify_password("new-password", user.password_hash)
    assert user.password_changed_at is not None
    assert len(db.refresh_tokens) == 2
    assert db.refresh_tokens[0].revoked_at == user.password_changed_at
    assert db.refresh_tokens[1].revoked_at is None
    assert queued[0]["category"] == "password.changed"
    assert queued[0]["recipient"] == "user@example.com"
    assert db.commits == 1


@pytest.mark.asyncio
async def test_current_user_password_change_rejects_wrong_current_password() -> None:
    db = FakeDb()
    user = User(
        email="user@example.com",
        display_name="User",
        password_hash=security.get_password_hash("old-password"),
        is_active=True,
        email_verified_at=utc_now_naive(),
    )
    db.add(user)

    with pytest.raises(ValidationException) as exc:
        await PasswordService().change_current_user_password(
            db,  # type: ignore[arg-type]
            user,
            ChangePasswordRequest(
                current_password="wrong-password",
                new_password="new-password",
                locale="en",
            ),
        )

    assert exc.value.code == ErrorCode.CURRENT_PASSWORD_WRONG
    assert security.verify_password("old-password", user.password_hash)
    assert db.commits == 0


@pytest.mark.asyncio
async def test_session_list_marks_current_active_session() -> None:
    db = FakeDb()
    service = SessionService()
    current_token = "current-refresh-token"
    expired_token = "expired-refresh-token"
    db.add(
        RefreshToken(
            user_id=1,
            token_hash=service._hash_token(current_token),
            user_agent="Current Browser",
            ip_address="127.0.0.1",
            expires_at=utc_now_naive() + timedelta(days=1),
        )
    )
    db.add(
        RefreshToken(
            user_id=1,
            token_hash=service._hash_token("other-refresh-token"),
            user_agent="Other Browser",
            ip_address="127.0.0.2",
            expires_at=utc_now_naive() + timedelta(days=1),
        )
    )
    db.add(
        RefreshToken(
            user_id=1,
            token_hash=service._hash_token(expired_token),
            expires_at=utc_now_naive() - timedelta(seconds=1),
        )
    )
    db.add(
        RefreshToken(
            user_id=2,
            token_hash=service._hash_token("another-user-token"),
            expires_at=utc_now_naive() + timedelta(days=1),
        )
    )

    sessions = await service.list_user_sessions(
        db,  # type: ignore[arg-type]
        1,
        current_refresh_token=current_token,
    )

    assert len(sessions) == 2
    assert [session.is_current for session in sessions].count(True) == 1
    assert next(session for session in sessions if session.is_current).user_agent == (
        "Current Browser"
    )


@pytest.mark.asyncio
async def test_revoke_user_session_revokes_only_target_session() -> None:
    db = FakeDb()
    service = SessionService()
    current_token = "current-refresh-token"
    target = RefreshToken(
        user_id=1,
        token_hash=service._hash_token("target-token"),
        expires_at=utc_now_naive() + timedelta(days=1),
    )
    current = RefreshToken(
        user_id=1,
        token_hash=service._hash_token(current_token),
        expires_at=utc_now_naive() + timedelta(days=1),
    )
    db.add(target)
    db.add(current)

    revoked_current = await service.revoke_user_session(
        db,  # type: ignore[arg-type]
        1,
        target.id,
        current_refresh_token=current_token,
    )

    assert revoked_current is False
    assert target.revoked_at is not None
    assert current.revoked_at is None
    assert db.commits == 1


@pytest.mark.asyncio
async def test_revoke_other_user_sessions_keeps_current_session() -> None:
    db = FakeDb()
    service = SessionService()
    current_token = "current-refresh-token"
    current = RefreshToken(
        user_id=1,
        token_hash=service._hash_token(current_token),
        expires_at=utc_now_naive() + timedelta(days=1),
    )
    other = RefreshToken(
        user_id=1,
        token_hash=service._hash_token("other-refresh-token"),
        expires_at=utc_now_naive() + timedelta(days=1),
    )
    another_user = RefreshToken(
        user_id=2,
        token_hash=service._hash_token("another-user-token"),
        expires_at=utc_now_naive() + timedelta(days=1),
    )
    db.add(current)
    db.add(other)
    db.add(another_user)

    await service.revoke_other_user_sessions(
        db,  # type: ignore[arg-type]
        1,
        current_refresh_token=current_token,
    )

    assert current.revoked_at is None
    assert other.revoked_at is not None
    assert another_user.revoked_at is None
    assert db.commits == 1


@pytest.mark.asyncio
async def test_security_overview_returns_identity_security_summary() -> None:
    db = FakeDb()
    user = User(
        email="user@example.com",
        display_name="User",
        password_hash=security.get_password_hash("password"),
        is_active=True,
        email_verified_at=utc_now_naive(),
        password_changed_at=utc_now_naive(),
    )
    db.add(user)

    overview = await SecurityService().overview(db, user)  # type: ignore[arg-type]

    assert overview.email == "user@example.com"
    assert overview.email_verified_at is not None
    assert overview.password_changed_at is not None
    assert overview.mfa_enabled is False
    assert overview.mfa_available is False
