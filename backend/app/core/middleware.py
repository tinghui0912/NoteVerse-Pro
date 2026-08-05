"""HTTP middleware used by the FastAPI application."""

import time
from dataclasses import dataclass
from collections.abc import Callable
from urllib.parse import urlparse

from fastapi import Request
from starlette.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.client_address import client_address, peer_address
from app.core.logger import logger, set_request_id
from app.core.metrics import record_http_request
from app.core.tracing import capture_current_trace_context
from app.shared.constants import ErrorCode
from app.shared.responses import error_response


SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
HEALTH_PATHS = {"/health/live", "/health/ready", "/metrics"}


@dataclass(frozen=True, slots=True)
class CookieCsrfSettings:
    api_prefix: str
    session_cookie_names: tuple[str, ...]
    csrf_cookie_name: str
    csrf_header_name: str
    exempt_paths: tuple[str, ...]
    allowed_origins: tuple[str, ...] | Callable[[], tuple[str, ...]]
    debug: bool


def normalize_origin(origin: str) -> str | None:
    """Return a canonical origin string for strict same-origin checks."""

    parsed = urlparse(origin)
    if not parsed.scheme or not parsed.hostname:
        return None

    scheme = parsed.scheme.lower()
    hostname = parsed.hostname.lower()
    port = parsed.port
    if port is None or (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        return f"{scheme}://{hostname}"
    return f"{scheme}://{hostname}:{port}"


class CsrfProtectionMiddleware(BaseHTTPMiddleware):
    """Require a double-submit CSRF token for cookie-authenticated writes."""

    def __init__(self, app, *, csrf_settings: CookieCsrfSettings) -> None:
        super().__init__(app)
        self.csrf_settings = csrf_settings

    async def dispatch(self, request: Request, call_next):
        if self._should_check_origin(request) and not self._has_allowed_origin(request):
            response = JSONResponse(
                status_code=403,
                content=self._error_payload(
                    request,
                    ErrorCode.REQUEST_ORIGIN_INVALID,
                ),
            )
            self._attach_request_id_header(request, response)
            return response

        if self._should_check(request):
            csrf_cookie = request.cookies.get(self.csrf_settings.csrf_cookie_name)
            csrf_header = request.headers.get(self.csrf_settings.csrf_header_name)
            if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
                response = JSONResponse(
                    status_code=403,
                    content=self._error_payload(
                        request,
                        ErrorCode.CSRF_TOKEN_INVALID,
                    ),
                )
                self._attach_request_id_header(request, response)
                return response

        return await call_next(request)

    def _request_id(self, request: Request) -> str:
        existing = getattr(request.state, "request_id", None)
        if isinstance(existing, str) and existing:
            return existing
        request_id = set_request_id(request.headers.get("X-Request-ID"))
        request.state.request_id = request_id
        return request_id

    def _error_payload(
        self,
        request: Request,
        code: str,
    ):
        return error_response(
            public_code=code,
            public_message=code,
            request_id=self._request_id(request),
        )

    def _attach_request_id_header(self, request: Request, response: JSONResponse) -> None:
        response.headers["X-Request-ID"] = self._request_id(request)

    def _should_check(self, request: Request) -> bool:
        path = request.url.path
        if request.method.upper() in SAFE_METHODS:
            return False
        if not path.startswith(self.csrf_settings.api_prefix):
            return False
        if any(path == exempt or path.startswith(exempt) for exempt in self.csrf_settings.exempt_paths):
            return False
        return any(request.cookies.get(cookie_name) for cookie_name in self.csrf_settings.session_cookie_names)

    def _should_check_origin(self, request: Request) -> bool:
        return (
            request.method.upper() not in SAFE_METHODS
            and request.url.path.startswith(self.csrf_settings.api_prefix)
            and any(
                request.cookies.get(cookie_name)
                for cookie_name in self.csrf_settings.session_cookie_names
            )
        )

    def _has_allowed_origin(self, request: Request) -> bool:
        origin = request.headers.get("origin")
        referer = request.headers.get("referer")
        if not origin and not referer:
            return True

        source = origin or referer
        if not source:
            return True

        parsed_source = urlparse(source)
        if not parsed_source.scheme or not parsed_source.netloc:
            return False

        request_origin = normalize_origin(f"{request.url.scheme}://{request.url.netloc}")
        source_origin = normalize_origin(source)
        configured_origins = (
            self.csrf_settings.allowed_origins()
            if callable(self.csrf_settings.allowed_origins)
            else self.csrf_settings.allowed_origins
        )
        allowed_origins = {
            normalized
            for origin in configured_origins
            if (normalized := normalize_origin(str(origin).rstrip("/"))) is not None
        }
        if request_origin is not None:
            allowed_origins.add(request_origin)
        if source_origin is not None and source_origin in allowed_origins:
            return True

        return self.csrf_settings.debug and self._is_loopback_dev_origin(request, parsed_source)

    def _is_loopback_dev_origin(self, request: Request, parsed_source) -> bool:
        request_host = request.url.hostname
        source_host = parsed_source.hostname
        loopback_hosts = {"localhost", "127.0.0.1", "::1"}
        return request_host in loopback_hosts and source_host in loopback_hosts


class LoggingMiddleware(BaseHTTPMiddleware):
    """Log request lifecycle events and attach tracing headers."""

    async def dispatch(self, request: Request, call_next):
        # Record the start time for latency logging.
        start_time = time.time()

        # Use an incoming request ID when present, otherwise generate one.
        request_id = request.headers.get("X-Request-ID")
        request_id = set_request_id(request_id)
        request.state.request_id = request_id
        capture_current_trace_context()

        should_log = request.url.path not in HEALTH_PATHS
        base_log = logger.bind(
            event="api.request",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            peer_address=peer_address(request) or "unknown",
            client_address=client_address(request) or "unknown",
        )
        try:
            response = await call_next(request)

            # Measure request duration.
            process_time = time.time() - start_time
            duration_ms = round(process_time * 1000, 2)
            self._record_metrics(
                request=request,
                status_code=response.status_code,
                duration_seconds=process_time,
            )

            # Escalate log level for error responses.
            if response.status_code >= 500:
                status_label = "ERROR"
                level = "ERROR"
            elif response.status_code >= 400:
                status_label = "WARN"
                level = "WARNING"
            else:
                status_label = "OK"
                level = "INFO"

            # Log the response result.
            if should_log:
                capture_current_trace_context()
                base_log.bind(
                    event="api.request_completed",
                    status_label=status_label,
                    status_code=response.status_code,
                    duration_ms=duration_ms,
                ).log(level, "api.request_completed")

            # Return trace metadata to the caller.
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Process-Time"] = f"{process_time:.3f}"

            return response

        except Exception as e:
            process_time = time.time() - start_time
            self._record_metrics(
                request=request,
                status_code=500,
                duration_seconds=process_time,
            )
            base_log.bind(
                event="api.request_exception",
                exception_type=type(e).__name__,
                duration_ms=round(process_time * 1000, 2),
            ).opt(exception=True).error("api.request_exception")
            raise

    def _record_metrics(
        self,
        *,
        request: Request,
        status_code: int,
        duration_seconds: float,
    ) -> None:
        if request.url.path in HEALTH_PATHS:
            return
        route = getattr(request.scope.get("route"), "path", None)
        record_http_request(
            method=request.method,
            route=route or request.url.path,
            status_code=status_code,
            duration_seconds=duration_seconds,
        )
