import pytest
from pydantic import ValidationError

from app.core.settings.customer_session_security import CustomerSessionSecuritySettings


def _settings(**overrides: object) -> CustomerSessionSecuritySettings:
    values: dict[str, object] = {
        "AUTH_COOKIE_NAME": "noteverse_session",
        "REFRESH_COOKIE_NAME": "noteverse_refresh",
        "CSRF_COOKIE_NAME": "noteverse_csrf",
        "CSRF_HEADER_NAME": "x-csrf-token",
        "AUTH_COOKIE_SECURE": True,
        "AUTH_COOKIE_SAMESITE": "lax",
    }
    values.update(overrides)
    return CustomerSessionSecuritySettings(**values)


def test_customer_session_security_settings_accept_default_lifetimes() -> None:
    settings = _settings()

    assert settings.ACCESS_TOKEN_EXPIRE_MINUTES == 15
    assert settings.REFRESH_TOKEN_EXPIRE_DAYS == 30


@pytest.mark.parametrize("field_name", ("ACCESS_TOKEN_EXPIRE_MINUTES", "REFRESH_TOKEN_EXPIRE_DAYS"))
def test_customer_session_security_settings_reject_non_positive_lifetimes(field_name: str) -> None:
    with pytest.raises(ValidationError, match="customer session lifetimes must be positive"):
        _settings(**{field_name: 0})


@pytest.mark.parametrize(
    "field_name",
    ("AUTH_COOKIE_NAME", "REFRESH_COOKIE_NAME", "CSRF_COOKIE_NAME", "CSRF_HEADER_NAME"),
)
def test_customer_session_security_settings_reject_empty_cookie_contract_values(
    field_name: str,
) -> None:
    with pytest.raises(ValidationError, match="customer session cookie contract values"):
        _settings(**{field_name: " "})


@pytest.mark.parametrize("value", ("Lax", "invalid"))
def test_customer_session_security_settings_reject_invalid_samesite_values(value: str) -> None:
    with pytest.raises(ValidationError, match="AUTH_COOKIE_SAMESITE"):
        _settings(AUTH_COOKIE_SAMESITE=value)
