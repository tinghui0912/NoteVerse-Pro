"""Scoped environment contract for this process."""

from pydantic_settings import BaseSettings, SettingsConfigDict
from app.runtime.config_blocks import DatabaseConfig


class MigrationSettings(DatabaseConfig, BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore", frozen=False)
