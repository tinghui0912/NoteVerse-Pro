import pytest
from pydantic import ValidationError

from app.core.settings.public_frontend_url import PublicFrontendUrlSettings


def test_public_frontend_url_settings_accept_http_and_https_urls() -> None:
    assert PublicFrontendUrlSettings(FRONTEND_BASE_URL="http://localhost:3000").FRONTEND_BASE_URL
    assert PublicFrontendUrlSettings(FRONTEND_BASE_URL="https://app.example.com").FRONTEND_BASE_URL


@pytest.mark.parametrize(
    "url",
    ("app.example.com", "ftp://app.example.com", "https://app.example.com/?source=mail", "https://app.example.com/#invite"),
)
def test_public_frontend_url_settings_reject_invalid_base_urls(url: str) -> None:
    with pytest.raises(ValidationError, match="FRONTEND_BASE_URL"):
        PublicFrontendUrlSettings(FRONTEND_BASE_URL=url)
