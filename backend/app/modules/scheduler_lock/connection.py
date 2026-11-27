"""Dedicated PostgreSQL sessions for scheduler advisory locks.

Session-level advisory locks must never traverse a transaction-pooling
connection. This module is the only connection factory for both the Beat
leader lock and short-lived scheduler scan locks.
"""

from __future__ import annotations


import psycopg
from psycopg import Connection

from app.platform.config.beat_scheduler import BeatSchedulerSettings


def open_scheduler_lock_connection(
    *, application_name: str, config: BeatSchedulerSettings
) -> Connection:
    """Open a bounded, diagnosable session suitable for an advisory lock."""

    return psycopg.connect(
        _psycopg_dsn(config.SCHEDULER_LOCK_DATABASE_URL),
        autocommit=True,
        application_name=application_name,
        connect_timeout=config.SCHEDULER_LOCK_CONNECT_TIMEOUT_SECONDS,
        keepalives=1,
        keepalives_idle=config.SCHEDULER_LOCK_KEEPALIVES_IDLE_SECONDS,
        keepalives_interval=config.SCHEDULER_LOCK_KEEPALIVES_INTERVAL_SECONDS,
        keepalives_count=config.SCHEDULER_LOCK_KEEPALIVES_COUNT,
        tcp_user_timeout=config.SCHEDULER_LOCK_TCP_USER_TIMEOUT_MILLISECONDS,
        options=(f"-c statement_timeout={config.SCHEDULER_LOCK_STATEMENT_TIMEOUT_MILLISECONDS}"),
    )


def _psycopg_dsn(database_url: str) -> str:
    """Convert the accepted SQLAlchemy PostgreSQL URL to a psycopg DSN."""

    return database_url.replace("postgresql+psycopg://", "postgresql://", 1)
