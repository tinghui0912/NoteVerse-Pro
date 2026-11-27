"""Database factories with explicit inputs and no environment loading."""

from typing import Protocol

import app.platform.db.instants  # noqa: F401 - register the session invariant

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker


class DatabaseConnectionConfig(Protocol):
    @property
    def DATABASE_URL(self) -> str: ...


def build_engine(config: DatabaseConnectionConfig) -> Engine:
    return create_engine(
        config.DATABASE_URL,
        connect_args={"options": "-c timezone=UTC"},
        pool_pre_ping=True,
        pool_recycle=3600,
        pool_size=5,
        max_overflow=10,
    )


def build_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
