import pytest
from pydantic import ValidationError

from app.core.settings.trusted_proxy import TrustedProxySettings


def test_trusted_proxy_settings_normalize_explicit_cidr_allowlist() -> None:
    settings = TrustedProxySettings(
        TRUSTED_PROXY_CIDRS='["10.0.0.7/8", "2001:db8::1/32"]'
    )

    assert settings.TRUSTED_PROXY_CIDRS == ["10.0.0.0/8", "2001:db8::/32"]


@pytest.mark.parametrize(
    "value",
    ("10.0.0.0/8", '["0.0.0.0/0"]', '["not-a-network"]'),
)
def test_trusted_proxy_settings_reject_invalid_allowlists(value: str) -> None:
    with pytest.raises(ValidationError, match="TRUSTED_PROXY_CIDRS"):
        TrustedProxySettings(TRUSTED_PROXY_CIDRS=value)
