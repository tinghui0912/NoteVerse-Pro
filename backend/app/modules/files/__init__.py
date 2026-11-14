"""Lazy package exports for the files module."""

from importlib import import_module

__all__ = ["router", "get_files_service"]


def __getattr__(name):
    if name == "router":
        return import_module("app.modules.files.router").router
    if name == "get_files_service":
        return import_module("app.modules.files.dependencies").get_files_service
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
