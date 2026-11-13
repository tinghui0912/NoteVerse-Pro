"""Shared HTTP runtime wiring for independently composed FastAPI applications."""

from __future__ import annotations

from collections.abc import Iterable

from fastapi.middleware.cors import CORSMiddleware

from app.core.http_application import HttpApplication
from app.core.exception_handlers import ErrorResponseFactory, register_exception_handlers
from app.shared.responses import error_response
from app.core.middleware import CookieCsrfSettings, CsrfProtectionMiddleware, LoggingMiddleware
from app.core.tracing import configure_api_tracing


def normalized_cors_origins(origins: Iterable[object]) -> list[str]:
    """Return configured origins in the format expected by Starlette CORS."""
    return [str(origin).rstrip("/") for origin in origins]


def install_http_runtime(
    app: HttpApplication,
    *,
    csrf_settings: CookieCsrfSettings | None = None,
    cors_origins: list[str] | None = None,
    error_response_factory: ErrorResponseFactory = error_response,
) -> None:
    """Install common cross-cutting HTTP behavior without choosing app policy."""
    app.add_middleware(LoggingMiddleware)
    if csrf_settings is not None:
        app.add_middleware(
            CsrfProtectionMiddleware,
            csrf_settings=csrf_settings,
            error_response_factory=error_response_factory,
        )
    if cors_origins is not None:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    register_exception_handlers(app, error_response_factory=error_response_factory)
    configure_api_tracing(app)
