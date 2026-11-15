from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.runtime_checks import check_database
from app.db.session import engine, SessionLocal


def test_application_sessions_use_the_configured_postgresql_engine():
    assert engine.url == make_url(settings.DATABASE_URL)
    assert engine.dialect.driver == "psycopg"
    assert engine.dialect.is_async is False
    with SessionLocal() as db:
        assert isinstance(db, Session)
        assert db.get_bind() is engine
        assert db.scalar(text("SHOW timezone")) == "UTC"


def test_independent_application_sessions_observe_committed_state():
    if not (engine.url.database or "").startswith("noteverse_test_"):
        pytest.skip("A dedicated application PostgreSQL test database is required")
    schema = "database_sessions_" + uuid4().hex
    try:
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(text(f'CREATE TABLE "{schema}".markers (value integer)'))
        with SessionLocal() as writer:
            writer.execute(text(f'INSERT INTO "{schema}".markers VALUES (1)'))
            writer.commit()
        with SessionLocal() as observer:
            assert list(observer.scalars(text(f'SELECT value FROM "{schema}".markers'))) == [1]
        with SessionLocal() as writer:
            writer.execute(text(f'INSERT INTO "{schema}".markers VALUES (2)'))
            writer.rollback()
        with SessionLocal() as observer:
            assert list(observer.scalars(text(f'SELECT value FROM "{schema}".markers'))) == [1]
        with SessionLocal() as uncommitted:
            uncommitted.execute(text(f'INSERT INTO "{schema}".markers VALUES (3)'))
        with SessionLocal() as observer:
            assert list(observer.scalars(text(f'SELECT value FROM "{schema}".markers'))) == [1]
        assert check_database().ok
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
