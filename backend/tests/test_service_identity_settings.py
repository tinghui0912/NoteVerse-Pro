import pytest
from pydantic import ValidationError

from app.core.settings.service_identity import CUSTOMER_API_PREFIX, ServiceIdentitySettings


def test_service_identity_settings_have_product_identity_defaults() -> None:
    settings = ServiceIdentitySettings()

    assert settings.PROJECT_NAME == "NoteVerse Pro"
    assert settings.DEBUG is False


@pytest.mark.parametrize(
    ("value", "expected"),
    (("development", True), ("release", False), ("1", True), ("0", False)),
)
def test_service_identity_settings_parse_debug_environment_labels(
    value: str, expected: bool
) -> None:
    assert ServiceIdentitySettings(DEBUG=value).DEBUG is expected


def test_customer_api_prefix_is_a_fixed_versioned_contract() -> None:
    assert CUSTOMER_API_PREFIX == "/api/v1"


def test_service_identity_settings_reject_blank_project_name() -> None:
    with pytest.raises(ValidationError, match="PROJECT_NAME"):
        ServiceIdentitySettings(PROJECT_NAME="  ")
