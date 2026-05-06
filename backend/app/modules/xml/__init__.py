"""Lazy package exports for the xml module."""

from importlib import import_module

__all__ = ["router", "get_xml_service"]


def __getattr__(name):
    if name == "router":
        return import_module("app.modules.xml.router").router
    if name == "get_xml_service":
        return import_module("app.modules.xml.dependencies").get_xml_service
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
