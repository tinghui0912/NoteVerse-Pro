from app.platform.runtime import RuntimeRole
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.runtime.diagnostics import checks_for_role
from app.runtime.customer_api.context import get_context

settings = get_context().settings


def test_application_sessions_use_the_configured_postgresql_engine():
    assert get_context().engine.url == make_url(settings.DATABASE_URL)
    assert get_context().engine.dialect.driver == "psycopg"
    assert get_context().engine.dialect.is_async is False
    with get_context().sessions() as db:
        assert isinstance(db, Session)
        assert db.get_bind() is get_context().engine
        assert db.scalar(text("SHOW timezone")) == "UTC"


def test_independent_application_sessions_observe_committed_state():
    if not (get_context().engine.url.database or "").startswith("noteverse_test_"):
        pytest.skip("A dedicated application PostgreSQL test database is required")
    schema = "database_sessions_" + uuid4().hex
    try:
        with get_context().engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(text(f'CREATE TABLE "{schema}".markers (value integer)'))
        with get_context().sessions() as writer:
            writer.execute(text(f'INSERT INTO "{schema}".markers VALUES (1)'))
            writer.commit()
        with get_context().sessions() as observer:
            assert list(observer.scalars(text(f'SELECT value FROM "{schema}".markers'))) == [1]
        with get_context().sessions() as writer:
            writer.execute(text(f'INSERT INTO "{schema}".markers VALUES (2)'))
            writer.rollback()
        with get_context().sessions() as observer:
            assert list(observer.scalars(text(f'SELECT value FROM "{schema}".markers'))) == [1]
        with get_context().sessions() as uncommitted:
            uncommitted.execute(text(f'INSERT INTO "{schema}".markers VALUES (3)'))
        with get_context().sessions() as observer:
            assert list(observer.scalars(text(f'SELECT value FROM "{schema}".markers'))) == [1]
        assert checks_for_role(RuntimeRole.API).check_database().ok
    finally:
        with get_context().engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
