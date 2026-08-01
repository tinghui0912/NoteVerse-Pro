from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import hashlib

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.db.worker_session import sync_engine


class SchedulerLockService:
    """PostgreSQL advisory locks for cluster-safe scheduler scans."""

    _namespace = "noteverse:scheduler"

    @contextmanager
    def try_acquire(self, job_key: str) -> Iterator[bool]:
        connection = sync_engine.connect()
        acquired = False
        try:
            acquired = self._try_lock(connection, job_key)
            yield acquired
        finally:
            if acquired:
                self._unlock(connection, job_key)
            connection.close()

    def lock_key(self, job_key: str) -> int:
        digest = hashlib.sha256(f"{self._namespace}:{job_key}".encode("utf-8")).digest()
        return int.from_bytes(digest[:8], byteorder="big", signed=True)

    def _try_lock(self, connection: Connection, job_key: str) -> bool:
        self._require_postgresql(connection)
        result = connection.execute(
            text("select pg_try_advisory_lock(:lock_key)"),
            {"lock_key": self.lock_key(job_key)},
        )
        return bool(result.scalar_one())

    def _unlock(self, connection: Connection, job_key: str) -> None:
        connection.execute(
            text("select pg_advisory_unlock(:lock_key)"),
            {"lock_key": self.lock_key(job_key)},
        )

    @staticmethod
    def _require_postgresql(connection: Connection) -> None:
        if connection.dialect.name != "postgresql":
            raise RuntimeError("Scheduler advisory locks require PostgreSQL")


scheduler_lock_service = SchedulerLockService()
