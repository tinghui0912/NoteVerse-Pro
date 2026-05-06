"""Lazy package exports for the shares module."""

from importlib import import_module

__all__ = ["router", "get_share_service", "verify_share_ownership"]


def __getattr__(name):
    if name == "router":
        return import_module("app.modules.shares.router").router
    if name == "get_share_service":
        return import_module("app.modules.shares.dependencies").get_share_service
    if name == "verify_share_ownership":
        return import_module("app.modules.shares.dependencies").verify_share_ownership
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
