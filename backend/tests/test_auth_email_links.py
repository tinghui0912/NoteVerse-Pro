from __future__ import annotations

from datetime import timedelta

import pytest

from app.core import security
from app.core.config import settings
from app.core.exceptions import AuthenticationException, ValidationException
from app.db.models.auth import AuthToken, RefreshToken
from app.db.models.user import User
from app.modules.auth.schemas import ForgotPasswordRequest, RegisterRequest, ResetPasswordRequest
from app.modules.auth.service import (
    AUTH_TOKEN_EMAIL_VERIFICATION,
    AUTH_TOKEN_PASSWORD_RESET,
    AuthService,
)
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
        elif isinstance(record, RefreshToken):
            self.refresh_tokens.append(record)

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
async def test_register_creates_unverified_user_and_sends_verification_link(
    queued_mail: list[dict[str, object]],
) -> None:
    db = FakeDb()
    service = AuthService()

    user = await service.register(
        db,  # type: ignore[arg-type]
        RegisterRequest(
            email="User@Example.com",
            password="secret123",
            display_name="User",
            locale="en",
        ),
    )

    assert user.email == "user@example.com"
    assert user.email_verified_at is None
    assert db.auth_tokens[0].purpose == AUTH_TOKEN_EMAIL_VERIFICATION
    assert db.auth_tokens[0].used_at is None
    assert queued_mail[0]["recipient"] == "user@example.com"
    assert "/auth/verify-email?token=" in str(queued_mail[0]["text_body"])


@pytest.mark.asyncio
async def test_login_rejects_unverified_email(
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

    with pytest.raises(AuthenticationException) as exc:
        await service.login(db, "user@example.com", "secret123")  # type: ignore[arg-type]

    assert exc.value.code == ErrorCode.EMAIL_NOT_VERIFIED


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
