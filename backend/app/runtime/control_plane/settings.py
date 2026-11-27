"""Isolated operator environment contract."""

from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from app.runtime.config_blocks import DatabaseConfig, RedisConfig, ObservabilityConfig
from app.platform.config.service_identity import ServiceIdentitySettings
from app.platform.config.trusted_proxy import TrustedProxySettings
from app.platform.config.delivery import OpsDeliveryConfig
from app.platform.config.operator_session import OperatorSessionConfig


class ControlPlaneSettings(
    OpsDeliveryConfig,
    DatabaseConfig,
    RedisConfig,
    ObservabilityConfig,
    ServiceIdentitySettings,
    TrustedProxySettings,
    BaseSettings,
):
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

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore", frozen=False)

    def to_security_settings(self) -> OperatorSessionConfig:
        return OperatorSessionConfig(
            cookie_secure=self.CONTROL_PLANE_COOKIE_SECURE,
            cookie_samesite=self.CONTROL_PLANE_COOKIE_SAMESITE,
            session_expire_minutes=self.CONTROL_PLANE_SESSION_EXPIRE_MINUTES,
            cors_origins=tuple(
                str(origin).rstrip("/") for origin in self.CONTROL_PLANE_CORS_ORIGINS
            ),
        )
