from datetime import timedelta

import pytest
from pydantic import ValidationError

from app.core import security
from app.platform.config.token_signing import TokenSigningSettings
from app.runtime.customer_api.context import get_context


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
    config = TokenSigningSettings(SECRET_KEY="a" * 32)

    token = security.create_access_token("42", secret_key=config.SECRET_KEY)

    assert security.decode_token(token, secret_key=config.SECRET_KEY)["sub"] == "42"


def test_access_token_rejects_a_tampered_signature() -> None:
    token = security.create_access_token("42", secret_key=get_context().settings.SECRET_KEY)
    header, payload, signature = token.split(".")
    changed_signature = ("A" if signature[0] != "A" else "B") + signature[1:]

    with pytest.raises(ValueError, match="^Invalid token$"):
        security.decode_token(
            f"{header}.{payload}.{changed_signature}", secret_key=get_context().settings.SECRET_KEY
        )


def test_access_token_rejects_an_expired_token() -> None:
    token = security.create_access_token(
        "42", expires_delta=timedelta(seconds=-60), secret_key=get_context().settings.SECRET_KEY
    )

    with pytest.raises(ValueError, match="^Token has expired$"):
        security.decode_token(token, secret_key=get_context().settings.SECRET_KEY)
