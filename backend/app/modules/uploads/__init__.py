"""Lazy package exports for the uploads module."""

from importlib import import_module

__all__ = ["router", "get_upload_service"]


def __getattr__(name):
    if name == "router":
        return import_module("app.modules.uploads.router").router
    if name == "get_upload_service":
        return import_module("app.modules.uploads.dependencies").get_upload_service
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
