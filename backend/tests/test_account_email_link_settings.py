import pytest
from pydantic import ValidationError

from app.core.settings.account_email_link import AccountEmailLinkSettings


def test_account_email_link_settings_accept_default_lifetimes() -> None:
    settings = AccountEmailLinkSettings()

    assert settings.EMAIL_PASSWORD_RESET_TOKEN_TTL_SECONDS == 300
    assert settings.EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS == 900


@pytest.mark.parametrize(
    "field_name",
    ("EMAIL_PASSWORD_RESET_TOKEN_TTL_SECONDS", "EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS"),
)
def test_account_email_link_settings_reject_non_positive_lifetimes(field_name: str) -> None:
    with pytest.raises(ValidationError, match="account email-link lifetimes must be positive"):
        AccountEmailLinkSettings(**{field_name: 0})
