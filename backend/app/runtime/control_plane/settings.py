"""Isolated operator environment contract."""

from pydantic import AnyHttpUrl, Field, field_validator, model_validator
from typing import Literal
from app.platform.security.totp import validate_encryption_key
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
    CONTROL_PLANE_CORS_ORIGINS: list[AnyHttpUrl]
    OPERATOR_TOTP_ENCRYPTION_KEY: str = Field(repr=False)
    ENVIRONMENT: Literal["development", "test", "staging", "production"] = "development"

    @field_validator("OPERATOR_TOTP_ENCRYPTION_KEY")
    @classmethod
    def validate_totp_key(cls, value: str) -> str:
        return validate_encryption_key(value)

    @model_validator(mode="after")
    def secure_production_cookie(self):
        if self.ENVIRONMENT in {"staging", "production"} and not self.CONTROL_PLANE_COOKIE_SECURE:
            raise ValueError("Secure operator cookies are required in staging and production")
        return self

    @field_validator("CONTROL_PLANE_CORS_ORIGINS")
    @classmethod
    def validate_cors_origins(cls, value: list[AnyHttpUrl]) -> list[AnyHttpUrl]:
        if not value:
            raise ValueError("CONTROL_PLANE_CORS_ORIGINS must not be empty")
        return value

    model_config = SettingsConfigDict(
        case_sensitive=True, extra="ignore", frozen=False, hide_input_in_errors=True
    )

    def to_security_settings(self) -> OperatorSessionConfig:
        return OperatorSessionConfig(
            cookie_secure=self.CONTROL_PLANE_COOKIE_SECURE,
            encryption_key=self.OPERATOR_TOTP_ENCRYPTION_KEY,
            cors_origins=tuple(
                str(origin).rstrip("/") for origin in self.CONTROL_PLANE_CORS_ORIGINS
            ),
        )
