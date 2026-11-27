from __future__ import annotations


from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from app.modules.scheduler_observability.service import SchedulerRunStats
from app.runtime.beat.leader import BeatLeader, parse_args
from app.modules.scheduler_lock.connection import open_scheduler_lock_connection
from app.modules.scheduler_lock.keys import scheduler_lock_key
from app.modules.scheduler_lock.service import SchedulerLockService
from app.worker import task_runtime
from tests.support.worker_context import inject_worker
from app.platform.config.beat_scheduler import BeatSchedulerSettings
from app.runtime.worker.context import get_context as get_worker_context


def test_scheduler_lock_key_is_stable_and_job_scoped() -> None:
    service = SchedulerLockService(config=get_worker_context().settings)

    first = service.lock_key("score_revision_render_outbox")
    second = service.lock_key("score_revision_render_outbox")
    other = service.lock_key("playback_outbox")

    assert first == second
    assert first != other
    assert -(2**63) <= first < 2**63


def test_beat_leader_lock_key_is_stable_and_distinct_from_scan_locks() -> None:
    assert scheduler_lock_key("beat_leader") == scheduler_lock_key("beat_leader")
    assert scheduler_lock_key("beat_leader") != scheduler_lock_key("score_revision_render_outbox")


def test_beat_leader_parses_the_child_command() -> None:
    assert parse_args(["--", "python", "-m", "celery", "beat"]) == [
        "python",
        "-m",
        "celery",
        "beat",
    ]


def test_beat_leader_uses_a_dedicated_postgresql_session() -> None:
    """The lifetime lock must not be held through the worker SQLAlchemy pool."""

    lock_key = scheduler_lock_key("beat_leader_direct_connection_test")
    first = BeatLeader._connect()
    second = BeatLeader._connect()
    try:
        assert first.autocommit
        with first.cursor() as cursor:
            cursor.execute("select pg_try_advisory_lock(%s)", (lock_key,))
            assert cursor.fetchone()[0]
        with second.cursor() as cursor:
            cursor.execute("select pg_try_advisory_lock(%s)", (lock_key,))
            assert not cursor.fetchone()[0]
    finally:
        with first.cursor() as cursor:
            cursor.execute("select pg_advisory_unlock(%s)", (lock_key,))
        first.close()
        second.close()


def test_scheduler_scan_lock_uses_the_dedicated_postgresql_session() -> None:
    service = SchedulerLockService(config=get_worker_context().settings)

    with service.try_acquire("scheduler_scan_direct_connection_test") as acquired:
        assert acquired
        with service.try_acquire("scheduler_scan_direct_connection_test") as duplicate:
            assert not duplicate


def test_scheduler_lock_connection_has_diagnostic_application_name() -> None:
    with open_scheduler_lock_connection(
        application_name="noteverse-scheduler-test",
        config=BeatSchedulerSettings.model_validate(get_worker_context().settings.model_dump()),
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select current_setting('application_name')")
            assert cursor.fetchone()[0] == "noteverse-scheduler-test"


def test_scheduler_scan_skips_callback_when_lock_is_not_acquired(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[str, str]] = []

    class FakeObservabilityService:
        def record_lock_skipped(self, db: object, job_key: str) -> None:
            events.append(("skipped", job_key))

    @contextmanager
    def fake_lock(self, _job_key: str) -> Iterator[bool]:
        yield False

    @contextmanager
    def fake_db() -> Iterator[object]:
        yield __import__("unittest.mock", fromlist=["Mock"]).Mock()

    def callback() -> dict[str, int]:
        raise AssertionError("callback should not run when scheduler lock is not acquired")

    monkeypatch.setattr(task_runtime.SchedulerLockService, "try_acquire", fake_lock)
    inject_worker(monkeypatch, task_runtime, sessions=fake_db)
    monkeypatch.setattr(
        task_runtime,
        "scheduler_observability_service",
        FakeObservabilityService(),
    )

    result = task_runtime.run_scheduler_scan("score_revision_render_outbox", callback)

    assert result == {"due": 0, "dispatched": 0, "lock_skipped": 1}
    assert events == [("skipped", "score_revision_render_outbox")]


def test_scheduler_scan_runs_callback_when_lock_is_acquired(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[str, str]] = []
    trace_roots: list[dict[str, object]] = []

    class FakeObservabilityService:
        def record_lock_acquired(self, db: object, job_key: str) -> None:
            events.append(("acquired", job_key))

        def record_started(self, db: object, job_key: str) -> None:
            events.append(("started", job_key))

        def record_success(
            self,
            db: object,
            job_key: str,
            *,
            duration_seconds: float,
            stats: SchedulerRunStats,
        ) -> None:
            events.append(("success", job_key))

    @contextmanager
    def fake_lock(self, _job_key: str) -> Iterator[bool]:
        yield True

    @contextmanager
    def fake_db() -> Iterator[object]:
        yield __import__("unittest.mock", fromlist=["Mock"]).Mock()

    @contextmanager
    def fake_root_span(**kwargs: object) -> Iterator[None]:
        trace_roots.append(kwargs)
        yield

    monkeypatch.setattr(task_runtime.SchedulerLockService, "try_acquire", fake_lock)
    inject_worker(monkeypatch, task_runtime, sessions=fake_db)
    monkeypatch.setattr(
        task_runtime,
        "scheduler_observability_service",
        FakeObservabilityService(),
    )
    monkeypatch.setattr(task_runtime, "background_root_span", fake_root_span)

    result = task_runtime.run_scheduler_scan(
        "score_revision_render_outbox",
        lambda: {"due": 2, "dispatched": 1},
    )

    assert result == {"due": 2, "dispatched": 1}
    assert events == [
        ("acquired", "score_revision_render_outbox"),
        ("started", "score_revision_render_outbox"),
        ("success", "score_revision_render_outbox"),
    ]
    assert trace_roots == [
        {
            "name": "noteverse.scheduler.scan",
            "attributes": {
                "noteverse.operation.kind": "scheduler",
                "noteverse.scheduler.job": "score_revision_render_outbox",
            },
        }
    ]
