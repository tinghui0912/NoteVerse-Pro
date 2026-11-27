import pytest
from pydantic import ValidationError
from app.core.generated.control_plane_browser_protocol import CONTROL_PLANE_API_PREFIX
from app.runtime.control_plane.settings import ControlPlaneSettings


def test_control_plane_runtime_settings_accept_complete_operator_contract() -> None:
    runtime_settings = ControlPlaneSettings(
        CONTROL_PLANE_COOKIE_SECURE=True,
        CONTROL_PLANE_CORS_ORIGINS=["https://control.example.test"],
    )

    assert runtime_settings.to_security_settings().cors_origins == ("https://control.example.test",)


@pytest.mark.parametrize(
    "field,value",
    (
        ("CONTROL_PLANE_CORS_ORIGINS", []),
        ("OPERATOR_TOTP_ENCRYPTION_KEY", "invalid"),
    ),
)
def test_control_plane_runtime_settings_reject_invalid_operator_contract(
    field: str, value: object
) -> None:
    values = {
        "CONTROL_PLANE_COOKIE_SECURE": True,
        "CONTROL_PLANE_CORS_ORIGINS": ["https://control.example.test"],
    }
    values[field] = value

    with pytest.raises(ValidationError, match=field):
        ControlPlaneSettings(**values)


def test_control_plane_api_prefix_is_a_fixed_versioned_contract() -> None:
    assert CONTROL_PLANE_API_PREFIX == "/api/v1"


def test_totp_settings_errors_and_representation_do_not_display_key():
    values = {
        "CONTROL_PLANE_COOKIE_SECURE": True,
        "CONTROL_PLANE_CORS_ORIGINS": ["https://admin.example.com"],
        "OPERATOR_TOTP_ENCRYPTION_KEY": "private-invalid-key",
    }
    with pytest.raises(ValidationError) as failure:
        ControlPlaneSettings(**values)
    assert "private-invalid-key" not in str(failure.value)
    settings = ControlPlaneSettings(CONTROL_PLANE_COOKIE_SECURE=True)
    assert settings.OPERATOR_TOTP_ENCRYPTION_KEY not in repr(settings)
