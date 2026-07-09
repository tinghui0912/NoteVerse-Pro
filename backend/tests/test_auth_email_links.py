from __future__ import annotations

from datetime import timedelta

import pytest

from app.core import security
from app.core.config import settings
from app.core.exceptions import ResourceAlreadyExistsException, ValidationException
from app.db.models.auth import AuthToken, PendingRegistration, RefreshToken
from app.db.models.user import User
from app.modules.auth.schemas import (
    ForgotPasswordRequest,
    RegisterRequest,
    ResetPasswordRequest,
    VerifyEmailRequest,
)
from app.modules.auth.service import AUTH_TOKEN_PASSWORD_RESET, AuthService
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
        if entity is PendingRegistration:
            return FakeResult(self.pending_registrations)
        if entity is RefreshToken:
            return FakeResult(self.refresh_tokens)
        return FakeResult([])


@pytest.fixture
def queued_mail(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    queued: list[dict[str, object]] = []

    async def capture_mail(_db, **kwargs) -> None:
        queued.append(kwargs)

    monkeypatch.setattr("app.modules.auth.service.queue_mail", capture_mail)
    return queued


@pytest.mark.asyncio
async def test_register_creates_pending_registration_and_sends_verification_link(
    queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    service = AuthService()

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
    assert queued_mail[0]["recipient"] == "user@example.com"
    assert "/auth/verify-email?token=" in str(queued_mail[0]["text_body"])


@pytest.mark.asyncio
async def test_register_refreshes_existing_pending_registration(
    queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    service = AuthService()
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
    assert len(queued_mail) == 2


@pytest.mark.asyncio
async def test_verify_email_creates_user_and_removes_pending_registration(
    queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    service = AuthService()
    token = service._new_auth_token()
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
    service = AuthService()

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
async def test_password_reset_request_is_generic_for_unknown_email(
    queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    service = AuthService()

    await service.request_password_reset(
        db,  # type: ignore[arg-type]
        ForgotPasswordRequest(email="missing@example.com", locale="en"),
    )

    assert queued_mail == []
    assert db.auth_tokens == []


@pytest.mark.asyncio
async def test_password_reset_token_is_single_use(
    queued_mail: list[dict[str, object]],
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

    service = AuthService()
    token = await service._create_auth_token(
        db,  # type: ignore[arg-type]
        user.id,
        purpose=AUTH_TOKEN_PASSWORD_RESET,
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
    queued_mail: list[dict[str, object]],
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

    service = AuthService()
    token = await service._create_auth_token(
        db,  # type: ignore[arg-type]
        user.id,
        purpose=AUTH_TOKEN_PASSWORD_RESET,
        ttl_seconds=settings.EMAIL_PASSWORD_RESET_TOKEN_TTL_SECONDS,
    )
    db.auth_tokens[0].expires_at = utc_now_naive() - timedelta(seconds=1)

    with pytest.raises(ValidationException) as exc:
        await service.reset_password(
            db,  # type: ignore[arg-type]
            ResetPasswordRequest(new_password="new-password", token=token, locale="en"),
        )

    assert exc.value.code == ErrorCode.RESET_TOKEN_INVALID
