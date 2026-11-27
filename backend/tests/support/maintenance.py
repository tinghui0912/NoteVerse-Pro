"""Bind real maintenance execution and scheduler observations to an isolated database."""

from contextlib import nullcontext
from sqlalchemy.orm import sessionmaker
from app.worker import task_runtime
from app.worker.execution import maintenance_cleanup


def configure_maintenance(monkeypatch, engine):
    sessions = sessionmaker(engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(maintenance_cleanup, "SessionLocal", sessions)
    monkeypatch.setattr(task_runtime, "SessionLocal", sessions)
    monkeypatch.setattr(
        task_runtime.scheduler_lock_service, "try_acquire", lambda _key: nullcontext(True)
    )
    return maintenance_cleanup
