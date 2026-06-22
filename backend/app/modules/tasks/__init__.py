"""Lazy package exports for the tasks module."""

from importlib import import_module

__all__ = ["router"]


def __getattr__(name):
    if name == "router":
        return import_module("app.modules.tasks.router").router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
