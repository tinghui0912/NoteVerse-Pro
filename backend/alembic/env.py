import asyncio
from logging.config import fileConfig

from sqlalchemy import inspect, pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlmodel import SQLModel

from alembic import context
from app.core.config import settings
from app.db.models import *  # noqa: F401,F403 - register SQLModel metadata

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.

def _alembic_database_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


db_url = config.get_main_option("sqlalchemy.url")
if not db_url or db_url.startswith("driver://"):
    db_url = settings.DATABASE_URL
config.set_main_option("sqlalchemy.url", _alembic_database_url(db_url))

POSTGRESQL_ALEMBIC_VERSION_LENGTH = 128


def _prepare_postgresql_version_table(connection: Connection) -> None:
    """Ensure PostgreSQL's Alembic version table can store project revision ids.

    Alembic's default version_num width is 32 characters, while this repository
    already has revision identifiers up to 40 characters.  We create the table
    explicitly for fresh PostgreSQL databases and widen existing shorter tables
    before Alembic starts its migration transaction.  Any failure must abort the
    run so PostgreSQL does not continue after an aborted DDL transaction.
    """

    inspector = inspect(connection)
    if not inspector.has_table("alembic_version"):
        connection.execute(
            text(
                "CREATE TABLE alembic_version "
                f"(version_num VARCHAR({POSTGRESQL_ALEMBIC_VERSION_LENGTH}) NOT NULL, "
                "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
            )
        )
        return

    version_columns = {
        column["name"]: column for column in inspector.get_columns("alembic_version")
    }
    version_num = version_columns.get("version_num")
    if version_num is None:
        raise RuntimeError("Existing alembic_version table is missing version_num column")

    current_length = getattr(version_num["type"], "length", None)
    if current_length is None or current_length < POSTGRESQL_ALEMBIC_VERSION_LENGTH:
        connection.execute(
            text(
                "ALTER TABLE alembic_version "
                f"ALTER COLUMN version_num TYPE VARCHAR({POSTGRESQL_ALEMBIC_VERSION_LENGTH})"
            )
        )


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    if connection.dialect.name == "postgresql":
        _prepare_postgresql_version_table(connection)
        connection.commit()

    context.configure(
        connection=connection,
        target_metadata=target_metadata,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
