import pytest
from pydantic import ValidationError

from app.core.settings.browser_cors import BrowserCorsSettings


def test_browser_cors_settings_accept_url_array() -> None:
    settings = BrowserCorsSettings(
        BACKEND_CORS_ORIGINS=["https://app.example.com", "http://localhost:3000"]
    )

    assert [str(origin) for origin in settings.BACKEND_CORS_ORIGINS] == [
        "https://app.example.com/",
        "http://localhost:3000/",
    ]


def test_browser_cors_settings_allow_an_explicit_empty_list() -> None:
    assert BrowserCorsSettings(BACKEND_CORS_ORIGINS=[]).BACKEND_CORS_ORIGINS == []


@pytest.mark.parametrize("value", ("https://app.example.com", ["not-a-url"]))
def test_browser_cors_settings_reject_invalid_origin_configuration(value: object) -> None:
    with pytest.raises(ValidationError, match="BACKEND_CORS_ORIGINS"):
        BrowserCorsSettings(BACKEND_CORS_ORIGINS=value)  # type: ignore[arg-type]
