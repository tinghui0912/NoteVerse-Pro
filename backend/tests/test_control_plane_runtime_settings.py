import pytest
from pydantic import ValidationError

from app.core.control_plane_settings import (
    CONTROL_PLANE_API_PREFIX,
    ControlPlaneRuntimeSettings,
)


def test_control_plane_runtime_settings_accept_complete_operator_contract() -> None:
    runtime_settings = ControlPlaneRuntimeSettings(
        CONTROL_PLANE_AUTH_COOKIE_NAME="noteverse_control_session",
        CONTROL_PLANE_CSRF_COOKIE_NAME="noteverse_control_csrf",
        CONTROL_PLANE_CSRF_HEADER_NAME="x-control-csrf-token",
        CONTROL_PLANE_COOKIE_SECURE=True,
        CONTROL_PLANE_COOKIE_SAMESITE="strict",
        CONTROL_PLANE_SESSION_EXPIRE_MINUTES=30,
        CONTROL_PLANE_CORS_ORIGINS=["https://control.example.test"],
    )

    assert runtime_settings.to_security_settings().cors_origins == ("https://control.example.test",)


@pytest.mark.parametrize(
    "field,value",
    (
        ("CONTROL_PLANE_AUTH_COOKIE_NAME", " "),
        ("CONTROL_PLANE_COOKIE_SAMESITE", "invalid"),
        ("CONTROL_PLANE_SESSION_EXPIRE_MINUTES", 0),
        ("CONTROL_PLANE_CORS_ORIGINS", []),
    ),
)
def test_control_plane_runtime_settings_reject_invalid_operator_contract(
    field: str, value: object
) -> None:
    values = {
        "CONTROL_PLANE_AUTH_COOKIE_NAME": "noteverse_control_session",
        "CONTROL_PLANE_CSRF_COOKIE_NAME": "noteverse_control_csrf",
        "CONTROL_PLANE_CSRF_HEADER_NAME": "x-control-csrf-token",
        "CONTROL_PLANE_COOKIE_SECURE": True,
        "CONTROL_PLANE_COOKIE_SAMESITE": "strict",
        "CONTROL_PLANE_SESSION_EXPIRE_MINUTES": 30,
        "CONTROL_PLANE_CORS_ORIGINS": ["https://control.example.test"],
    }
    values[field] = value

    with pytest.raises(ValidationError, match=field):
        ControlPlaneRuntimeSettings(**values)


def test_control_plane_api_prefix_is_a_fixed_versioned_contract() -> None:
    assert CONTROL_PLANE_API_PREFIX == "/api/v1"
