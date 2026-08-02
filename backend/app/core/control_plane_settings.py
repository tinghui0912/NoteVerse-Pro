"""Strict runtime settings for the isolated control-plane HTTP surface."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import settings


@dataclass(frozen=True, slots=True)
class ControlPlaneSettings:
    auth_cookie_name: str
    csrf_cookie_name: str
    csrf_header_name: str
    cookie_secure: bool
    cookie_samesite: str
    session_expire_minutes: int
    cors_origins: tuple[str, ...]


def require_control_plane_settings() -> ControlPlaneSettings:
    """Return complete control-plane settings or fail before the app starts."""

    values = {
        "CONTROL_PLANE_AUTH_COOKIE_NAME": settings.CONTROL_PLANE_AUTH_COOKIE_NAME,
        "CONTROL_PLANE_CSRF_COOKIE_NAME": settings.CONTROL_PLANE_CSRF_COOKIE_NAME,
        "CONTROL_PLANE_CSRF_HEADER_NAME": settings.CONTROL_PLANE_CSRF_HEADER_NAME,
        "CONTROL_PLANE_COOKIE_SECURE": settings.CONTROL_PLANE_COOKIE_SECURE,
        "CONTROL_PLANE_COOKIE_SAMESITE": settings.CONTROL_PLANE_COOKIE_SAMESITE,
        "CONTROL_PLANE_SESSION_EXPIRE_MINUTES": settings.CONTROL_PLANE_SESSION_EXPIRE_MINUTES,
        "CONTROL_PLANE_CORS_ORIGINS": settings.CONTROL_PLANE_CORS_ORIGINS,
    }
    missing = [name for name, value in values.items() if value is None or value == ""]
    if missing:
        raise RuntimeError("Missing required control-plane settings: " + ", ".join(missing))

    session_expire_minutes = settings.CONTROL_PLANE_SESSION_EXPIRE_MINUTES
    cookie_samesite = settings.CONTROL_PLANE_COOKIE_SAMESITE
    cors_origins = settings.CONTROL_PLANE_CORS_ORIGINS
    if session_expire_minutes is None or session_expire_minutes <= 0:
        raise RuntimeError("CONTROL_PLANE_SESSION_EXPIRE_MINUTES must be greater than zero")
    if cookie_samesite not in {"lax", "strict", "none"}:
        raise RuntimeError("CONTROL_PLANE_COOKIE_SAMESITE must be one of: lax, strict, none")
    if not cors_origins:
        raise RuntimeError("CONTROL_PLANE_CORS_ORIGINS must not be empty")

    return ControlPlaneSettings(
        auth_cookie_name=str(settings.CONTROL_PLANE_AUTH_COOKIE_NAME),
        csrf_cookie_name=str(settings.CONTROL_PLANE_CSRF_COOKIE_NAME),
        csrf_header_name=str(settings.CONTROL_PLANE_CSRF_HEADER_NAME),
        cookie_secure=bool(settings.CONTROL_PLANE_COOKIE_SECURE),
        cookie_samesite=cookie_samesite,
        session_expire_minutes=session_expire_minutes,
        cors_origins=tuple(str(origin).rstrip("/") for origin in cors_origins),
    )
