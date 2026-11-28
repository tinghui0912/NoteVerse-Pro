"""Controlled worker composition for execution tests."""

from dataclasses import replace
from unittest.mock import patch
from app.runtime.worker.context import get_context
from tests.support.runtime_resources import resources_for, deliveries


def worker_context(*, sessions=None, storage=None):
    context = get_context()
    factory = sessions if sessions is not None else context.sessions
    provider = storage if storage is not None else context.storage
    return replace(
        context,
        sessions=factory,
        storage=provider,
        resources=resources_for(provider, factory),
        deliveries=deliveries(),
    )


def patch_worker(module, *, sessions=None, storage=None):
    return patch.object(
        module, "get_context", return_value=worker_context(sessions=sessions, storage=storage)
    )


def inject_worker(monkeypatch, module, *, sessions=None, storage=None):
    current = module.get_context()
    factory = sessions if sessions is not None else current.sessions
    provider = storage if storage is not None else current.storage
    monkeypatch.setattr(current.resources, "sessions", factory)
    monkeypatch.setattr(current.resources, "storage", provider)
    monkeypatch.setattr(
        module,
        "get_context",
        lambda: replace(current, sessions=factory, storage=provider, deliveries=deliveries()),
    )
