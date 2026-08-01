from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from psycopg import Connection

from app.modules.scheduler_lock.connection import open_scheduler_lock_connection
from app.modules.scheduler_lock.keys import scheduler_lock_key


class SchedulerLockService:
    """PostgreSQL advisory locks for cluster-safe scheduler scans."""

    @contextmanager
    def try_acquire(self, job_key: str) -> Iterator[bool]:
        connection = open_scheduler_lock_connection(
            application_name=f"noteverse-scheduler-{job_key}"
        )
        acquired = False
        try:
            acquired = self._try_lock(connection, job_key)
            yield acquired
        finally:
            if acquired:
                self._unlock(connection, job_key)
            connection.close()

    def lock_key(self, job_key: str) -> int:
        return scheduler_lock_key(job_key)

    def _try_lock(self, connection: Connection, job_key: str) -> bool:
        with connection.cursor() as cursor:
            cursor.execute("select pg_try_advisory_lock(%s)", (self.lock_key(job_key),))
            return bool(cursor.fetchone()[0])

    def _unlock(self, connection: Connection, job_key: str) -> None:
        with connection.cursor() as cursor:
            cursor.execute("select pg_advisory_unlock(%s)", (self.lock_key(job_key),))


scheduler_lock_service = SchedulerLockService()
