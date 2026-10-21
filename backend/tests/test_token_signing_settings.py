from datetime import timedelta

import pytest
from pydantic import ValidationError

from app.core import security
from app.core.settings.token_signing import TokenSigningSettings


def test_token_signing_settings_accept_a_strong_secret() -> None:
    settings = TokenSigningSettings(SECRET_KEY="a" * 32)

    assert settings.SECRET_KEY == "a" * 32


@pytest.mark.parametrize("secret", ("short", " " * 32))
def test_token_signing_settings_reject_weak_secrets(secret: str) -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        TokenSigningSettings(SECRET_KEY=secret)


def test_token_signing_secret_can_sign_and_verify_customer_access_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(security.settings, "SECRET_KEY", "a" * 32)

    token = security.create_access_token("42")

    assert security.decode_token(token)["sub"] == "42"


def test_access_token_rejects_a_tampered_signature() -> None:
    token = security.create_access_token("42")
    header, payload, signature = token.split(".")
    changed_signature = ("A" if signature[0] != "A" else "B") + signature[1:]

    with pytest.raises(ValueError, match="^Invalid token$"):
        security.decode_token(f"{header}.{payload}.{changed_signature}")


def test_access_token_rejects_an_expired_token() -> None:
    token = security.create_access_token("42", expires_delta=timedelta(seconds=-60))

    with pytest.raises(ValueError, match="^Token has expired$"):
        security.decode_token(token)
