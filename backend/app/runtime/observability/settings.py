"""Scoped environment contract for this process."""

from pydantic_settings import BaseSettings, SettingsConfigDict
from app.runtime.config_blocks import DatabaseConfig, ObservabilityConfig
from app.platform.config.service_identity import ServiceIdentitySettings
from app.observability.async_operation_metrics import MetricsConfig


class ObservabilitySettings(
    DatabaseConfig, ObservabilityConfig, ServiceIdentitySettings, MetricsConfig, BaseSettings
):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore", frozen=False)
