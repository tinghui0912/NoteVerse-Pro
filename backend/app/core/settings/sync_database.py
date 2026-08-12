"""Synchronous database access settings."""

from pydantic import BaseModel, field_validator


class SyncDatabaseSettings(BaseModel):
    SYNC_DATABASE_URL: str

    @field_validator("SYNC_DATABASE_URL")
    @classmethod
    def validate_sync_database_url(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized.startswith(("postgresql://", "postgresql+psycopg://")):
            raise ValueError("SYNC_DATABASE_URL must use a PostgreSQL psycopg-compatible URL")
        return normalized
