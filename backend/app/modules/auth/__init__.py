"""Lazy package exports for the auth module."""

from importlib import import_module

__all__ = ["router", "get_auth_service"]


def __getattr__(name):
    if name == "router":
        return import_module("app.modules.auth.router").router
    if name == "get_auth_service":
        return import_module("app.modules.auth.dependencies").get_auth_service
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
