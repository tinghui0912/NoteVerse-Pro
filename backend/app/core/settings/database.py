"""The application PostgreSQL connection identity consumed by execution adapters."""

from pydantic import BaseModel, field_validator


class DatabaseSettings(BaseModel):
    DATABASE_URL: str

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized.startswith("postgresql+psycopg://"):
            raise ValueError("DATABASE_URL must use a postgresql+psycopg:// URL")
        return normalized
