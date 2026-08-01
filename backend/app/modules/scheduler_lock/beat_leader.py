"""Run Celery Beat only while this process owns the scheduler leader lock.

Celery Beat has no built-in cluster leader election.  The advisory lock is held
by one PostgreSQL session for the child Beat process' entire lifetime, so a
standby replica cannot publish a duplicate periodic schedule.  Task-level
locks in ``app.worker.tasks`` remain a separate defensive fence for duplicate
broker delivery.
"""

from __future__ import annotations

import argparse
import signal
import subprocess
import sys
from threading import Event
from time import monotonic

import psycopg
from psycopg import Connection

from app.core.config import settings
from app.core.logger import logger
from app.modules.scheduler_lock.connection import open_scheduler_lock_connection
from app.modules.scheduler_lock.constants import BEAT_LEADER_SCHEDULER_NAME
from app.modules.scheduler_lock.keys import scheduler_lock_key


class BeatLeader:
    """Active/standby supervisor for a Celery Beat subprocess."""

    def __init__(self, command: list[str]) -> None:
        if not command:
            raise ValueError("A Celery Beat command is required")
        self._command = command
        self._stop_requested = Event()
        self._leader_key = scheduler_lock_key(BEAT_LEADER_SCHEDULER_NAME)

    def run(self) -> int:
        self._install_signal_handlers()
        while not self._stop_requested.is_set():
            try:
                with self._connect() as connection:
                    if not self._try_acquire(connection):
                        self._record_standby(connection)
                        logger.bind(
                            event="scheduler.leader_standby",
                            operation_kind="scheduler",
                            scheduler_job=BEAT_LEADER_SCHEDULER_NAME,
                        ).info("scheduler.leader_standby")
                        self._wait(settings.SCHEDULER_LEADER_RETRY_INTERVAL_SECONDS)
                        continue

                    self._record_leader_acquired(connection)
                    logger.bind(
                        event="scheduler.leader_acquired",
                        operation_kind="scheduler",
                        scheduler_job=BEAT_LEADER_SCHEDULER_NAME,
                    ).info("scheduler.leader_acquired")
                    exit_code = self._run_leader_child(connection)
                    if self._stop_requested.is_set():
                        return 0
                    self._record_child_exit(connection, exit_code)
                    return exit_code
            except psycopg.Error as exc:
                logger.bind(
                    event="scheduler.leader_database_unavailable",
                    operation_kind="scheduler",
                    scheduler_job=BEAT_LEADER_SCHEDULER_NAME,
                    exception_type=type(exc).__name__,
                ).warning("scheduler.leader_database_unavailable")
                self._wait(settings.SCHEDULER_LEADER_RETRY_INTERVAL_SECONDS)
        return 0

    def _run_leader_child(self, connection: Connection) -> int:
        child = subprocess.Popen(self._command)
        last_heartbeat_at = 0.0
        try:
            while child.poll() is None and not self._stop_requested.is_set():
                self._wait(1)
                now = monotonic()
                if now - last_heartbeat_at < settings.SCHEDULER_LEADER_HEARTBEAT_INTERVAL_SECONDS:
                    continue
                self._record_leader_heartbeat(connection)
                last_heartbeat_at = now
        except psycopg.Error:
            # Losing the session releases the advisory lock. Stop the child
            # before this replica can publish another periodic schedule.
            logger.bind(
                event="scheduler.leader_connection_lost",
                operation_kind="scheduler",
                scheduler_job=BEAT_LEADER_SCHEDULER_NAME,
            ).error("scheduler.leader_connection_lost")
            self._terminate(child)
            raise

        if self._stop_requested.is_set():
            self._terminate(child)
            return 0
        return int(child.returncode or 0)

    def _try_acquire(self, connection: Connection) -> bool:
        with connection.cursor() as cursor:
            cursor.execute("select pg_try_advisory_lock(%s)", (self._leader_key,))
            return bool(cursor.fetchone()[0])

    @staticmethod
    def _connect() -> Connection:
        """Open the dedicated session that owns the PostgreSQL advisory lock."""

        return open_scheduler_lock_connection(application_name="noteverse-beat-leader")

    def _record_leader_acquired(self, connection: Connection) -> None:
        self._record_state(
            connection,
            """
            insert into scheduler_leader_statuses (
                scheduler_name, created_at, updated_at, acquired_count,
                last_acquired_at, last_heartbeat_at, last_error
            )
            values (%s, now(), now(), 1, now(), now(), null)
            on conflict (scheduler_name) do update
            set updated_at = now(),
                acquired_count = scheduler_leader_statuses.acquired_count + 1,
                last_acquired_at = excluded.last_acquired_at,
                last_heartbeat_at = excluded.last_heartbeat_at,
                last_error = null
            """,
        )

    def _record_leader_heartbeat(self, connection: Connection) -> None:
        self._record_state(
            connection,
            """
            insert into scheduler_leader_statuses (
                scheduler_name, created_at, updated_at, last_heartbeat_at
            )
            values (%s, now(), now(), now())
            on conflict (scheduler_name) do update
            set updated_at = now(),
                last_heartbeat_at = excluded.last_heartbeat_at
            """,
        )

    def _record_standby(self, connection: Connection) -> None:
        self._record_state(
            connection,
            """
            insert into scheduler_leader_statuses (
                scheduler_name, created_at, updated_at, standby_count, last_standby_at
            )
            values (%s, now(), now(), 1, now())
            on conflict (scheduler_name) do update
            set updated_at = now(),
                standby_count = scheduler_leader_statuses.standby_count + 1,
                last_standby_at = excluded.last_standby_at
            """,
        )

    def _record_child_exit(self, connection: Connection, exit_code: int) -> None:
        self._record_state(
            connection,
            """
            insert into scheduler_leader_statuses (
                scheduler_name, created_at, updated_at, child_exit_count,
                last_child_exit_at, last_error
            )
            values (%s, now(), now(), 1, now(), %s)
            on conflict (scheduler_name) do update
            set updated_at = now(),
                child_exit_count = scheduler_leader_statuses.child_exit_count + 1,
                last_child_exit_at = excluded.last_child_exit_at,
                last_error = excluded.last_error
            """,
            error=f"Celery Beat child exited with status {exit_code}",
        )

    @staticmethod
    def _record_state(
        connection: Connection,
        statement: str,
        *,
        error: str | None = None,
    ) -> None:
        with connection.cursor() as cursor:
            parameters: tuple[str, ...] = (BEAT_LEADER_SCHEDULER_NAME,)
            if error is not None:
                parameters += (error,)
            cursor.execute(statement, parameters)

    def _install_signal_handlers(self) -> None:
        def request_stop(_signum: int, _frame: object) -> None:
            self._stop_requested.set()

        signal.signal(signal.SIGTERM, request_stop)
        signal.signal(signal.SIGINT, request_stop)

    def _wait(self, seconds: float) -> None:
        self._stop_requested.wait(timeout=seconds)

    @staticmethod
    def _terminate(child: subprocess.Popen[bytes]) -> None:
        if child.poll() is not None:
            return
        child.terminate()
        try:
            child.wait(timeout=20)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)


def parse_args(argv: list[str]) -> list[str]:
    parser = argparse.ArgumentParser(description="Run Celery Beat under a PostgreSQL leader lock")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("the Celery Beat command must follow --")
    return command


def main(argv: list[str] | None = None) -> int:
    return BeatLeader(parse_args(list(sys.argv[1:] if argv is None else argv))).run()


if __name__ == "__main__":
    raise SystemExit(main())
