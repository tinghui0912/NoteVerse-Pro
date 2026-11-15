"""Isolated empty PostgreSQL schemas for real Alembic application-schema tests."""

from contextlib import contextmanager
import os
from pathlib import Path
from uuid import uuid4
import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from alembic.config import Config
from app.core.config import settings


@contextmanager
def postgres_schema_database(monkeypatch):
    raw_url = os.environ.get("NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL")
    if not raw_url:
        pytest.skip(
            "Set NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL for PostgreSQL schema validation"
        )
    url = make_url(raw_url).set(drivername="postgresql+psycopg")
    assert (url.database or "").startswith("noteverse_test_")
    schema = "schema_test_" + uuid4().hex
    admin = sa.create_engine(url)
    with admin.begin() as connection:
        connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
    monkeypatch.setenv("PGOPTIONS", f"-csearch_path={schema}")
    engine = sa.create_engine(url)
    backend = Path(__file__).resolve().parents[2]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "alembic"))
    monkeypatch.setattr(settings, "DATABASE_URL", url.render_as_string(hide_password=False))
    try:
        yield engine, config
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
