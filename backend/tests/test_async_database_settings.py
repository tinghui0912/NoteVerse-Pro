import pytest
from pydantic import ValidationError

from app.core.settings.async_database import AsyncDatabaseSettings


def test_async_database_settings_accept_asyncpg_postgresql_url() -> None:
    settings = AsyncDatabaseSettings(DATABASE_URL="postgresql+asyncpg://user:pass@db/noteverse")

    assert settings.DATABASE_URL.startswith("postgresql+asyncpg://")


def test_async_database_settings_reject_unsupported_url() -> None:
    with pytest.raises(ValidationError, match="Unsupported database URL format"):
        AsyncDatabaseSettings(DATABASE_URL="mongodb://db/noteverse")
