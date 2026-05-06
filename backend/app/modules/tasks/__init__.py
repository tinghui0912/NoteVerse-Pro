"""Lazy package exports for the tasks module."""

from importlib import import_module

__all__ = ["router", "task_execution_service"]


def __getattr__(name):
    if name == "router":
        return import_module("app.modules.tasks.router").router
    if name == "task_execution_service":
        return import_module("app.modules.tasks.execution_service").task_execution_service
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
