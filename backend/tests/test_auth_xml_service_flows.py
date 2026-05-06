from __future__ import annotations
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.core.exceptions import ValidationException
from app.modules.auth.schemas import SendCodeRequest, VerifyCodeRequest
from app.modules.auth.service import AuthService
from app.modules.xml.service import XMLService
from app.shared.constants import ErrorCode


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    def ttl(self, key: str) -> int:
        return self.ttls.get(key, -1)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.values[key] = value
        self.ttls[key] = ttl

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def delete(self, key: str) -> None:
        self.values.pop(key, None)
        self.ttls.pop(key, None)


def test_send_email_code_dispatches_email_and_stores_challenge() -> None:
    redis_client = FakeRedis()
    service = AuthService(redis_client=redis_client)
    request = SendCodeRequest(email="user@example.com", purpose="register")

    fake_uuid_for_challenge = SimpleNamespace(hex="challenge-123", int=111111)
    fake_uuid_for_code = SimpleNamespace(hex="unused", int=123456)

    with patch(
        "app.modules.auth.service.uuid.uuid4",
        side_effect=[fake_uuid_for_challenge, fake_uuid_for_code],
    ), patch("app.modules.auth.service.dispatch_email") as dispatch_email:
        result = service.send_email_code(request)

    assert result.challenge_id == "challenge-123"
    assert result.cooldown > 0
    assert "email_verify:challenge-123" in redis_client.values
    dispatch_email.assert_called_once()


def test_verify_email_code_returns_verified_token_and_clears_challenge() -> None:
    redis_client = FakeRedis()
    service = AuthService(redis_client=redis_client)
    request = VerifyCodeRequest(
        email="user@example.com",
        code="123456",
        challenge_id="challenge-123",
    )

    redis_client.values["email_verify:challenge-123"] = (
        '{"email":"user@example.com","code_hash":"%s","purpose":"register"}'
        % service._hash_code("123456", "user@example.com")
    )

    with patch(
        "app.modules.auth.service.security.create_access_token",
        return_value="verified-token",
    ):
        result = service.verify_email_code(request)

    assert result == {"verified_token": "verified-token"}
    assert "email_verify:challenge-123" not in redis_client.values


def test_verify_email_code_rejects_wrong_code() -> None:
    redis_client = FakeRedis()
    service = AuthService(redis_client=redis_client)
    request = VerifyCodeRequest(
        email="user@example.com",
        code="000000",
        challenge_id="challenge-123",
    )

    redis_client.values["email_verify:challenge-123"] = (
        '{"email":"user@example.com","code_hash":"%s","purpose":"register"}'
        % service._hash_code("123456", "user@example.com")
    )

    with pytest.raises(ValidationException) as context:
        service.verify_email_code(request)

    assert context.value.code == ErrorCode.VERIFICATION_CODE_WRONG


@pytest.mark.asyncio
async def test_save_xml_persists_content_and_uses_render_service() -> None:
    service = XMLService(
        render_service=Mock(render_images=AsyncMock(return_value=["preview/page-01.png"])),
    )
    db = SimpleNamespace(add=Mock(), commit=AsyncMock())
    task = SimpleNamespace(id=7, user_id=1)
    xml_file = None

    service._get_task = AsyncMock(return_value=task)
    service._find_file = AsyncMock(return_value=xml_file)

    with patch("app.modules.xml.service.settings.OUTPUT_FOLDER", "C:/tmp/output"):
        with patch("app.modules.xml.service.os.makedirs"), patch(
            "app.modules.xml.service.os.path.getsize",
            return_value=128,
        ), patch("builtins.open", create=True) as mocked_open:
            result = await service.save_xml(
                db,
                task_uuid="task-1",
                user_id=1,
                content="<xml />",
                file_type="current_xml",
                image_type="preview_image",
                dpi=200,
            )

    assert result["size_bytes"] == 128
    assert result["image_count"] == 1
    db.commit.assert_awaited()
    mocked_open.assert_called()
    service.render_service.render_images.assert_awaited_once()


@pytest.mark.asyncio
async def test_confirm_recognition_falls_back_to_preview_images() -> None:
    render_service = Mock(
        render_images=AsyncMock(return_value=[]),
        fallback_preview_to_final=AsyncMock(return_value=[{"path": "images/page-01.png", "page": 1}]),
    )
    service = XMLService(render_service=render_service)
    db = SimpleNamespace(add=Mock(), commit=AsyncMock(), execute=AsyncMock())
    task = SimpleNamespace(id=7, user_id=1, state="PROGRESS")
    current_file = SimpleNamespace(path="current.xml")

    service._get_task = AsyncMock(return_value=task)
    service._find_file = AsyncMock(return_value=current_file)
    service._upsert_file = AsyncMock()

    with patch("app.modules.xml.service.resolve_stored_path", return_value="C:/tmp/current.xml"), patch(
        "app.modules.xml.service.os.path.exists",
        return_value=True,
    ), patch("app.modules.xml.service.os.makedirs"), patch(
        "app.modules.xml.service.shutil.copy2"
    ):
        result = await service.confirm_recognition(db, "task-1", user_id=1, dpi=300)

    assert result["image_count"] == 1
    assert result["final_images"] == [{"path": "images/page-01.png", "page": 1}]
    assert task.state == "SUCCESS"
    render_service.render_images.assert_awaited_once()
    render_service.fallback_preview_to_final.assert_awaited_once()
    db.commit.assert_awaited()
