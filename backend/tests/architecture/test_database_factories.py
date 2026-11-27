"""Explicit database factories and per-application request ownership."""

from types import SimpleNamespace
from unittest.mock import Mock, MagicMock

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.platform.db.engine import build_engine, build_session_factory
from app.platform.db.dependencies import get_db, get_command_db
from app.runtime.config_blocks import DatabaseConfig


def test_engine_uses_only_explicit_database_input(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "invalid environment must not be read")
    engine = build_engine(
        DatabaseConfig(DATABASE_URL="postgresql+psycopg://test:test@127.0.0.1/explicit")
    )
    try:
        assert engine.url.database == "explicit"
        assert engine.dialect.driver == "psycopg"
        assert build_session_factory(engine).kw["autoflush"] is False
    finally:
        engine.dispose()


def request_for(factory):
    return Request(
        {"type": "http", "app": SimpleNamespace(state=SimpleNamespace(session_factory=factory))}
    )


def test_request_session_factory_is_specific_to_each_application():
    first, second = MagicMock(spec=Session), MagicMock(spec=Session)
    for db in (first, second):
        db.__enter__.return_value = db
        db.__exit__.side_effect = lambda *args, db=db: (db.close(), False)[1]
    first_factory, second_factory = Mock(return_value=first), Mock(return_value=second)
    dependency1, dependency2 = (
        get_db(request_for(first_factory)),
        get_db(request_for(second_factory)),
    )
    assert next(dependency1) is first
    assert next(dependency2) is second
    dependency1.close()
    dependency2.close()
    first.close.assert_called_once()
    second.close.assert_called_once()
    first.commit.assert_not_called()
    second.commit.assert_not_called()


def test_request_error_rolls_back_and_closes_only_its_session():
    db = MagicMock(spec=Session)
    db.__enter__.return_value = db
    db.__exit__.side_effect = lambda *args: (db.close(), False)[1]
    dependency = get_db(request_for(Mock(return_value=db)))
    assert next(dependency) is db
    with pytest.raises(ValueError):
        dependency.throw(ValueError("command rejected"))
    db.rollback.assert_called_once()
    db.close.assert_called_once()


def test_command_dependency_owns_commit():
    db = MagicMock(spec=Session)
    dependency = get_command_db(db)
    assert next(dependency) is db
    with pytest.raises(StopIteration):
        next(dependency)
    db.commit.assert_called_once()
    db.close.assert_not_called()


def test_factory_sessions_use_independent_transactions(postgres_engine):
    sessions = build_session_factory(postgres_engine)
    with sessions() as first, sessions() as second:
        assert first.scalar(text("SELECT pg_backend_pid()")) != second.scalar(
            text("SELECT pg_backend_pid()")
        )
        assert first.scalar(text("SHOW timezone")) == "UTC"
