import pytest
from pydantic import ValidationError

from app.core.settings.sync_database import SyncDatabaseSettings


def test_sync_database_settings_require_postgresql_sync_url() -> None:
    settings = SyncDatabaseSettings(SYNC_DATABASE_URL="postgresql+psycopg://user:pass@db/noteverse")
    assert settings.SYNC_DATABASE_URL.startswith("postgresql+psycopg://")

    with pytest.raises(ValidationError, match="SYNC_DATABASE_URL must use a PostgreSQL"):
        SyncDatabaseSettings(SYNC_DATABASE_URL="sqlite:///noteverse.db")
