"""Repair local databases left on unpublished practice feature revisions.

The practice source / performance take work was squashed before release. Some
developer databases may still have alembic_version pointing at removed
feature-branch revisions. This script only rewrites those known unpublished
revision markers so the final destructive 0053 migration can rebuild the
pre-release practice tables.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings


FINAL_PRE_PRACTICE_REVISION = "0052_practice_step_verifier_provider"
REMOVED_UNPUBLISHED_REVISIONS = {
    "0069_practice_source_snapshots",
}


def _repair_connection(conn) -> None:
    inspector = inspect(conn)
    if "alembic_version" not in inspector.get_table_names():
        return

    versions = conn.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
    removed_versions = [
        version for version in versions if version in REMOVED_UNPUBLISHED_REVISIONS
    ]
    if not removed_versions:
        return
    if len(versions) != len(removed_versions):
        raise RuntimeError(
            "Refusing to repair mixed Alembic heads. Found versions: "
            + ", ".join(sorted(versions))
        )

    conn.execute(text("DELETE FROM alembic_version"))
    conn.execute(
        text("INSERT INTO alembic_version (version_num) VALUES (:version)"),
        {"version": FINAL_PRE_PRACTICE_REVISION},
    )
    print(
        "Repaired unpublished practice migration marker: "
        f"{', '.join(sorted(removed_versions))} -> {FINAL_PRE_PRACTICE_REVISION}. "
        "The next Alembic upgrade will rebuild the pre-release practice source schema."
    )


async def _repair_async_database(url: str) -> None:
    engine = create_async_engine(url, future=True)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(_repair_connection)
    finally:
        await engine.dispose()


def _repair_sync_database(url: str) -> None:
    engine = create_engine(url, future=True)
    try:
        with engine.begin() as conn:
            _repair_connection(conn)
    finally:
        engine.dispose()


def main() -> None:
    database_url = settings.DATABASE_URL
    parsed = make_url(database_url)
    if parsed.drivername in {"postgresql+asyncpg", "sqlite+aiosqlite"}:
        asyncio.run(_repair_async_database(database_url))
        return
    _repair_sync_database(database_url)


if __name__ == "__main__":
    main()
