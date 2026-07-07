from __future__ import annotations

import json

import pytest
import redis

from app.core.config import settings
from app.core.exceptions import ExternalServiceException, ValidationException
from app.modules.auth.schemas import SendCodeRequest, VerifyCodeRequest
from app.modules.auth.service import AuthService, REDIS_KEY_VERIFY_PREFIX
from app.shared.constants import ErrorCode


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    def setex(self, key: str, seconds: int, value: str) -> None:
        self.values[key] = value
        self.ttls[key] = seconds

    def ttl(self, key: str) -> int:
        return self.ttls.get(key, -2)

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def delete(self, key: str) -> None:
        self.values.pop(key, None)
        self.ttls.pop(key, None)


class UnavailableRedis:
    def ttl(self, key: str) -> int:
        raise redis.RedisError("redis unavailable")

    def get(self, key: str) -> str | None:
        raise redis.RedisError("redis unavailable")

    def setex(self, key: str, seconds: int, value: str) -> None:
        raise redis.RedisError("redis unavailable")

    def delete(self, key: str) -> None:
        raise redis.RedisError("redis unavailable")


def _verification_key(challenge_id: str) -> str:
    return f"{REDIS_KEY_VERIFY_PREFIX}{challenge_id}"


class FakeDb:
    def __init__(self, user_exists: bool = False) -> None:
        self.user_exists = user_exists

    async def exec(self, statement):
        return self

    def one_or_none(self):
        return object() if self.user_exists else None

    async def commit(self) -> None:
        return None

    async def rollback(self) -> None:
        return None


async def noop_queue_mail(*_args, **_kwargs) -> None:
    return None


@pytest.mark.asyncio
async def test_send_email_code_uses_localized_html_templates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = FakeRedis()
    queued: list[dict[str, object]] = []

    async def capture_mail(_db, **kwargs) -> None:
        queued.append(kwargs)

    monkeypatch.setattr(
        "app.modules.auth.service.queue_mail",
        capture_mail,
    )

    service = AuthService(redis_client=redis)  # type: ignore[arg-type]
    result = await service.send_email_code(
        FakeDb(), SendCodeRequest(email="User@Example.com", purpose="register", locale="zh")
    )

    key = _verification_key(result.challenge_id)
    payload = json.loads(redis.values[key])
    assert payload["email"] == "user@example.com"
    assert payload["purpose"] == "register"
    assert payload["attempts"] == 0
    assert redis.ttl(key) == settings.EMAIL_REGISTER_CODE_TTL_SECONDS
    assert queued[0]["recipient"] == "user@example.com"
    assert "注册验证码" in str(queued[0]["subject"])
    assert "10 分钟" in str(queued[0]["text_body"])
    assert "<html" in str(queued[0]["html_body"])
    assert queued[0]["dedupe_key"] == f"verification:{result.challenge_id}"


@pytest.mark.asyncio
async def test_send_email_code_reports_verification_store_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queued: list[dict[str, object]] = []

    async def capture_mail(_db, **kwargs) -> None:
        queued.append(kwargs)

    monkeypatch.setattr(
        "app.modules.auth.service.queue_mail",
        capture_mail,
    )

    service = AuthService(redis_client=UnavailableRedis())  # type: ignore[arg-type]
    with pytest.raises(ExternalServiceException) as exc:
        await service.send_email_code(
            FakeDb(),
            SendCodeRequest(email="user@example.com", purpose="register", locale="zh"),
        )

    assert exc.value.code == ErrorCode.EMAIL_SERVICE_UNAVAILABLE
    assert exc.value.status_code == 503
    assert queued == []


@pytest.mark.asyncio
async def test_password_reset_code_rejects_unknown_email(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    queued: list[dict[str, object]] = []

    async def capture_mail(_db, **kwargs) -> None:
        queued.append(kwargs)

    monkeypatch.setattr(
        "app.modules.auth.service.queue_mail",
        capture_mail,
    )

    service = AuthService(redis_client=redis)  # type: ignore[arg-type]
    with pytest.raises(ValidationException) as exc:
        await service.send_email_code(
            FakeDb(user_exists=False),
            SendCodeRequest(email="missing@example.com", purpose="password_reset", locale="en"),
        )

    assert exc.value.code == ErrorCode.EMAIL_NOT_FOUND
    assert queued == []


@pytest.mark.asyncio
async def test_password_reset_code_uses_shorter_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(
        "app.modules.auth.service.queue_mail",
        noop_queue_mail,
    )

    service = AuthService(redis_client=redis)  # type: ignore[arg-type]
    result = await service.send_email_code(
        FakeDb(user_exists=True),
        SendCodeRequest(email="user@example.com", purpose="password_reset", locale="en"),
    )

    key = _verification_key(result.challenge_id)
    assert redis.ttl(key) == settings.EMAIL_PASSWORD_RESET_CODE_TTL_SECONDS


@pytest.mark.asyncio
async def test_email_code_attempt_limit_deletes_challenge(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(
        "app.modules.auth.service.queue_mail",
        noop_queue_mail,
    )

    service = AuthService(redis_client=redis)  # type: ignore[arg-type]
    result = await service.send_email_code(
        FakeDb(), SendCodeRequest(email="user@example.com", purpose="register", locale="en")
    )
    key = _verification_key(result.challenge_id)

    for _ in range(settings.EMAIL_CODE_MAX_ATTEMPTS - 1):
        with pytest.raises(ValidationException) as wrong_code:
            service.verify_email_code(
                VerifyCodeRequest(
                    email="user@example.com",
                    code="000000",
                    challenge_id=result.challenge_id,
                )
            )
        assert wrong_code.value.code == ErrorCode.VERIFICATION_CODE_WRONG

    with pytest.raises(ValidationException) as exceeded:
        service.verify_email_code(
            VerifyCodeRequest(
                email="user@example.com",
                code="000000",
                challenge_id=result.challenge_id,
            )
        )

    assert exceeded.value.code == ErrorCode.VERIFICATION_ATTEMPTS_EXCEEDED
    assert redis.get(key) is None
