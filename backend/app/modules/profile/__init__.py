"""Lazy package exports for the profile module."""

from importlib import import_module

__all__ = ["router", "get_avatar_service"]


def __getattr__(name):
    if name == "router":
        return import_module("app.modules.profile.router").router
    if name == "get_avatar_service":
        return import_module("app.modules.profile.dependencies").get_avatar_service
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
