from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import pytest

from app.modules.scheduler_observability.service import SchedulerRunStats
from app.modules.scheduler_lock.service import SchedulerLockService
from app.worker import tasks


def test_scheduler_lock_key_is_stable_and_job_scoped() -> None:
    service = SchedulerLockService()

    first = service.lock_key("render_outbox")
    second = service.lock_key("render_outbox")
    other = service.lock_key("playback_outbox")

    assert first == second
    assert first != other
    assert -(2**63) <= first < 2**63


def test_scheduler_scan_skips_callback_when_lock_is_not_acquired(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[str, str]] = []

    class FakeObservabilityService:
        def record_lock_skipped(self, db: object, job_key: str) -> None:
            events.append(("skipped", job_key))

    @contextmanager
    def fake_lock(_job_key: str) -> Iterator[bool]:
        yield False

    @contextmanager
    def fake_db() -> Iterator[object]:
        yield object()

    def callback() -> dict[str, int]:
        raise AssertionError("callback should not run when scheduler lock is not acquired")

    monkeypatch.setattr(tasks.scheduler_lock_service, "try_acquire", fake_lock)
    monkeypatch.setattr(tasks, "get_worker_db", fake_db)
    monkeypatch.setattr(tasks, "scheduler_observability_service", FakeObservabilityService())

    result = tasks._run_scheduler_scan("render_outbox", callback)

    assert result == {"due": 0, "dispatched": 0, "lock_skipped": 1}
    assert events == [("skipped", "render_outbox")]


def test_scheduler_scan_runs_callback_when_lock_is_acquired(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[str, str]] = []

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
    def fake_lock(_job_key: str) -> Iterator[bool]:
        yield True

    @contextmanager
    def fake_db() -> Iterator[object]:
        yield object()

    monkeypatch.setattr(tasks.scheduler_lock_service, "try_acquire", fake_lock)
    monkeypatch.setattr(tasks, "get_worker_db", fake_db)
    monkeypatch.setattr(tasks, "scheduler_observability_service", FakeObservabilityService())

    result = tasks._run_scheduler_scan("render_outbox", lambda: {"due": 2, "dispatched": 1})

    assert result == {"due": 2, "dispatched": 1}
    assert events == [
        ("acquired", "render_outbox"),
        ("started", "render_outbox"),
        ("success", "render_outbox"),
    ]
