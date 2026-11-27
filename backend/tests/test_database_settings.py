import pytest
from pydantic import ValidationError

from app.core.settings.database import DatabaseSettings


def test_database_settings_preserve_the_explicit_psycopg_identity() -> None:
    url = "postgresql+psycopg://user:pass@db/noteverse?sslmode=require"
    settings = DatabaseSettings(DATABASE_URL=f" {url} ")

    assert settings.DATABASE_URL == url
    assert set(DatabaseSettings.model_fields) == {"DATABASE_URL"}


@pytest.mark.parametrize(
    "url", ["mongodb://db/noteverse", "sqlite:///noteverse.db", "mysql://db/score"]
)
def test_database_settings_require_the_postgresql_psycopg_contract(url) -> None:
    with pytest.raises(ValidationError, match="DATABASE_URL must use a postgresql"):
        DatabaseSettings(DATABASE_URL=url)
