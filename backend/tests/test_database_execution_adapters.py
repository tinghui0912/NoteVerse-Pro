import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.core.runtime_checks import check_api_database_execution, check_worker_database_execution
from app.db.session import engine
from app.db.sync_session import sync_engine


def test_application_execution_adapters_consume_the_configured_database_identity():
    assert engine.url == sync_engine.url == make_url(settings.DATABASE_URL)
    assert engine.dialect.driver == sync_engine.dialect.driver == "psycopg"
    assert engine.dialect.is_async is True
    assert sync_engine.dialect.is_async is False


@pytest.mark.asyncio
async def test_application_execution_adapters_share_committed_postgresql_state():
    if not (engine.url.database or "").startswith("noteverse_test_"):
        pytest.skip("A dedicated application PostgreSQL test database is required")
    schema = "database_adapters_" + uuid4().hex
    try:
        async with engine.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            await connection.execute(text(f'CREATE TABLE "{schema}".markers (value integer)'))
            await connection.execute(text(f'INSERT INTO "{schema}".markers VALUES (1)'))

        def synchronous_work():
            with sync_engine.begin() as connection:
                assert connection.scalar(text(f'SELECT value FROM "{schema}".markers')) == 1
                connection.execute(text(f'INSERT INTO "{schema}".markers VALUES (2)'))

        await asyncio.to_thread(synchronous_work)
        async with engine.connect() as connection:
            assert list(
                (
                    await connection.scalars(
                        text(f'SELECT value FROM "{schema}".markers ORDER BY value')
                    )
                ).all()
            ) == [1, 2]
        api = await check_api_database_execution()
        worker = await asyncio.to_thread(check_worker_database_execution)
        assert api.ok and api.name == "api_database_execution"
        assert worker.ok and worker.name == "worker_database_execution"
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()
        await asyncio.to_thread(sync_engine.dispose)
