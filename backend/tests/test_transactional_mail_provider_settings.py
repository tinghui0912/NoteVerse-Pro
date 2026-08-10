import pytest
from pydantic import ValidationError

from app.core.settings.transactional_mail_provider import TransactionalMailProviderSettings


def test_transactional_mail_provider_settings_allow_an_explicitly_disabled_provider() -> None:
    settings = TransactionalMailProviderSettings()

    assert settings.MAIL_DEFAULT_SENDER is None
    assert settings.RESEND_API_KEY is None


def test_transactional_mail_provider_settings_accept_complete_provider_configuration() -> None:
    settings = TransactionalMailProviderSettings(
        MAIL_DEFAULT_SENDER="NoteVerse Pro <no-reply@example.com>",
        RESEND_API_KEY="re_test_key",
        RESEND_API_URL="https://api.resend.com/emails",
    )

    assert settings.RESEND_API_URL == "https://api.resend.com/emails"


@pytest.mark.parametrize(
    "values",
    (
        {"MAIL_DEFAULT_SENDER": "NoteVerse Pro <no-reply@example.com>"},
        {"RESEND_API_KEY": "re_test_key"},
    ),
)
def test_transactional_mail_provider_settings_reject_partial_configuration(
    values: dict[str, str],
) -> None:
    with pytest.raises(ValidationError, match="must be configured together"):
        TransactionalMailProviderSettings(**values)


@pytest.mark.parametrize("url", ("api.resend.com/emails", "ftp://api.resend.com/emails"))
def test_transactional_mail_provider_settings_reject_invalid_api_url(url: str) -> None:
    with pytest.raises(ValidationError, match="RESEND_API_URL"):
        TransactionalMailProviderSettings(RESEND_API_URL=url)
