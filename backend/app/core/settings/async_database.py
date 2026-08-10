"""Async database connection settings for API and Practice runtimes."""

from __future__ import annotations

from pydantic import BaseModel, field_validator


class AsyncDatabaseSettings(BaseModel):
    DATABASE_URL: str

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        supported_prefixes = (
            "postgresql://", "postgresql+asyncpg://", "postgresql+psycopg://",
            "mysql://", "mysql+asyncmy://", "mysql+aiomysql://", "mysql+pymysql://",
            "sqlite://", "sqlite+aiosqlite://",
        )
        if not value.startswith(supported_prefixes):
            raise ValueError(
                f"Unsupported database URL format: {value}\n"
                "Supported engines: PostgreSQL, MySQL, SQLite"
            )
        return value
