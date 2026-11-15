"""Strict runtime settings and routing for the isolated control-plane surface."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


from app.core.generated.control_plane_browser_protocol import (
    OPERATOR_AUTH_COOKIE_NAME,
    OPERATOR_CSRF_COOKIE_NAME,
    OPERATOR_CSRF_HEADER_NAME,
)


@dataclass(frozen=True, slots=True)
class ControlPlaneSettings:
    cookie_secure: bool
    cookie_samesite: str
    session_expire_minutes: int
    cors_origins: tuple[str, ...]

    @property
    def auth_cookie_name(self) -> str:
        return OPERATOR_AUTH_COOKIE_NAME

    @property
    def csrf_cookie_name(self) -> str:
        return OPERATOR_CSRF_COOKIE_NAME

    @property
    def csrf_header_name(self) -> str:
        return OPERATOR_CSRF_HEADER_NAME


class ControlPlaneRuntimeSettings(BaseSettings):
    """Required environment contract for the operator-only HTTP runtime."""

    CONTROL_PLANE_COOKIE_SECURE: bool
    CONTROL_PLANE_COOKIE_SAMESITE: str
    CONTROL_PLANE_SESSION_EXPIRE_MINUTES: int
    CONTROL_PLANE_CORS_ORIGINS: list[AnyHttpUrl]

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
