"""Bind real maintenance execution and scheduler observations to an isolated database."""

from contextlib import nullcontext
from sqlalchemy.orm import sessionmaker
from app.worker import task_runtime
from app.worker.execution import maintenance_cleanup
from tests.support.worker_context import inject_worker


def configure_maintenance(monkeypatch, engine):
    sessions = sessionmaker(engine, autoflush=False, expire_on_commit=False)
    inject_worker(monkeypatch, maintenance_cleanup, sessions=sessions)
    inject_worker(monkeypatch, task_runtime, sessions=sessions)
    monkeypatch.setattr(
        task_runtime.SchedulerLockService, "try_acquire", lambda self, _key: nullcontext(True)
    )
    return maintenance_cleanup
