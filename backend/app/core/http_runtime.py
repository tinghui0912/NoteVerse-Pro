"""Shared HTTP runtime wiring for independently composed FastAPI applications."""

from __future__ import annotations


from collections.abc import Iterable

from fastapi.middleware.cors import CORSMiddleware

from app.core.http_application import HttpApplication
from app.core.exception_handlers import register_exception_handlers
from app.core.http_error_policy import ErrorResponseFactory, HttpRuntimeErrorCodes
from app.core.middleware import LoggingMiddleware
from app.platform.security.origin_guard import BrowserOriginGuard, normalize_origin
from fastapi import Request
from starlette.responses import JSONResponse
from starlette.types import Scope
from app.core.request_correlation import request_correlation_id
from app.core.tracing import configure_api_tracing


def normalized_cors_origins(origins: Iterable[object]) -> list[str]:
    """Return configured origins in the format expected by Starlette CORS."""
    return [normalize_origin(str(origin)) for origin in origins]


def install_http_runtime(
    app: HttpApplication,
    *,
    trusted_proxy_cidrs: tuple[str, ...],
    trusted_proxy_hops: int = 0,
    allowed_origins: frozenset[str] | None = None,
    multipart_allowed_paths: tuple[str, ...] = (),
    cors_origins: list[str] | None = None,
    error_response_factory: ErrorResponseFactory,
    error_codes: HttpRuntimeErrorCodes,
) -> None:
    """Install common cross-cutting HTTP behavior without choosing app policy."""
    app.add_middleware(
        LoggingMiddleware,
        trusted_proxy_cidrs=trusted_proxy_cidrs,
        trusted_proxy_hops=trusted_proxy_hops,
    )
    if allowed_origins is not None:

        def rejection(scope: Scope, status: int) -> JSONResponse:
            code = (
                error_codes.request_origin_invalid
                if status == 403
                else error_codes.unsupported_media_type
            )
            return JSONResponse(
                status_code=status,
                content=error_response_factory(code, request_correlation_id(Request(scope))),
            )

        app.add_middleware(
            BrowserOriginGuard,
            allowed_origins=allowed_origins,
            multipart_allowed_paths=multipart_allowed_paths,
            error_response=rejection,
        )
    if cors_origins is not None:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Accept", "Content-Type", "X-Request-ID", "Traceparent", "Tracestate"],
        )
    register_exception_handlers(
        app, error_response_factory=error_response_factory, error_codes=error_codes
    )
    configure_api_tracing(app, app.state.settings)
