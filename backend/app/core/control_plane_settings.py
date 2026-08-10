"""Strict runtime settings and routing for the isolated control-plane surface."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# The operator API is served on its own host. This path is a versioned source
# contract, not a deployment knob and not an alias for the customer API prefix.
CONTROL_PLANE_API_PREFIX = "/api/v1"


@dataclass(frozen=True, slots=True)
class ControlPlaneSettings:
    auth_cookie_name: str
    csrf_cookie_name: str
    csrf_header_name: str
    cookie_secure: bool
    cookie_samesite: str
    session_expire_minutes: int
    cors_origins: tuple[str, ...]


class ControlPlaneRuntimeSettings(BaseSettings):
    """Required environment contract for the operator-only HTTP runtime."""

    CONTROL_PLANE_AUTH_COOKIE_NAME: str
    CONTROL_PLANE_CSRF_COOKIE_NAME: str
    CONTROL_PLANE_CSRF_HEADER_NAME: str
    CONTROL_PLANE_COOKIE_SECURE: bool
    CONTROL_PLANE_COOKIE_SAMESITE: str
    CONTROL_PLANE_SESSION_EXPIRE_MINUTES: int
    CONTROL_PLANE_CORS_ORIGINS: list[AnyHttpUrl]

    @field_validator(
        "CONTROL_PLANE_AUTH_COOKIE_NAME",
        "CONTROL_PLANE_CSRF_COOKIE_NAME",
        "CONTROL_PLANE_CSRF_HEADER_NAME",
    )
    @classmethod
    def validate_non_blank_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("control-plane cookie and header names must not be blank")
        return value

    @field_validator("CONTROL_PLANE_COOKIE_SAMESITE")
    @classmethod
    def validate_cookie_samesite(cls, value: str) -> str:
        if value not in {"lax", "strict", "none"}:
            raise ValueError("CONTROL_PLANE_COOKIE_SAMESITE must be one of: lax, strict, none")
        return value

    @field_validator("CONTROL_PLANE_SESSION_EXPIRE_MINUTES")
    @classmethod
    def validate_session_expiry(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("CONTROL_PLANE_SESSION_EXPIRE_MINUTES must be greater than zero")
        return value

    @field_validator("CONTROL_PLANE_CORS_ORIGINS")
    @classmethod
    def validate_cors_origins(cls, value: list[AnyHttpUrl]) -> list[AnyHttpUrl]:
        if not value:
            raise ValueError("CONTROL_PLANE_CORS_ORIGINS must not be empty")
        return value

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")

    def to_security_settings(self) -> ControlPlaneSettings:
        return ControlPlaneSettings(
            auth_cookie_name=self.CONTROL_PLANE_AUTH_COOKIE_NAME,
            csrf_cookie_name=self.CONTROL_PLANE_CSRF_COOKIE_NAME,
            csrf_header_name=self.CONTROL_PLANE_CSRF_HEADER_NAME,
            cookie_secure=self.CONTROL_PLANE_COOKIE_SECURE,
            cookie_samesite=self.CONTROL_PLANE_COOKIE_SAMESITE,
            session_expire_minutes=self.CONTROL_PLANE_SESSION_EXPIRE_MINUTES,
            cors_origins=tuple(
                str(origin).rstrip("/") for origin in self.CONTROL_PLANE_CORS_ORIGINS
            ),
        )


@lru_cache
def get_control_plane_runtime_settings() -> ControlPlaneRuntimeSettings:
    """Load Control Plane settings only for its isolated runtime surface."""

    return ControlPlaneRuntimeSettings()


def require_control_plane_settings() -> ControlPlaneSettings:
    """Return complete Control Plane security settings or fail at startup."""

    return get_control_plane_runtime_settings().to_security_settings()
