"""HTTP middleware used by the FastAPI application."""

import time
from urllib.parse import urlparse

from fastapi import Request
from starlette.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.logger import logger, set_trace_id
from app.shared.constants import ErrorCode
from app.shared.responses import error_response


SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
HEALTH_PATHS = {"/health/live", "/health/ready"}
CSRF_EXEMPT_PATHS = (
    f"{settings.API_V1_STR}/auth/login",
    f"{settings.API_V1_STR}/auth/refresh",
    f"{settings.API_V1_STR}/auth/register",
    f"{settings.API_V1_STR}/auth/email/",
    f"{settings.API_V1_STR}/auth/password/",
)


class CsrfProtectionMiddleware(BaseHTTPMiddleware):
    """Require a double-submit CSRF token for cookie-authenticated writes."""

    async def dispatch(self, request: Request, call_next):
        if self._should_check_origin(request) and not self._has_allowed_origin(request):
            response = JSONResponse(
                status_code=403,
                content=self._error_payload(
                    request,
                    ErrorCode.REQUEST_ORIGIN_INVALID,
                    {"reason": "origin_mismatch"},
                ),
            )
            self._attach_request_id_header(request, response)
            return response

        if self._should_check(request):
            csrf_cookie = request.cookies.get(settings.CSRF_COOKIE_NAME)
            csrf_header = request.headers.get(settings.CSRF_HEADER_NAME)
            if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
                response = JSONResponse(
                    status_code=403,
                    content=self._error_payload(
                        request,
                        ErrorCode.CSRF_TOKEN_INVALID,
                        {"reason": "csrf_token_mismatch"},
                    ),
                )
                self._attach_request_id_header(request, response)
                return response

        return await call_next(request)

    def _request_id(self, request: Request) -> str:
        existing = getattr(request.state, "request_id", None)
        if isinstance(existing, str) and existing:
            return existing
        request_id = set_trace_id(request.headers.get("X-Request-ID"))
        request.state.request_id = request_id
        return request_id

    def _error_payload(
        self,
        request: Request,
        code: str,
        details: dict[str, object],
    ):
        return error_response(
            error=code,
            code=code,
            details=details,
            request_id=self._request_id(request),
        )

    def _attach_request_id_header(self, request: Request, response: JSONResponse) -> None:
        response.headers["X-Request-ID"] = self._request_id(request)

    def _should_check(self, request: Request) -> bool:
        path = request.url.path
        if request.method.upper() in SAFE_METHODS:
            return False
        if not path.startswith(settings.API_V1_STR):
            return False
        if any(path == exempt or path.startswith(exempt) for exempt in CSRF_EXEMPT_PATHS):
            return False
        return bool(
            request.cookies.get(settings.AUTH_COOKIE_NAME)
            or request.cookies.get(settings.REFRESH_COOKIE_NAME)
        )

    def _should_check_origin(self, request: Request) -> bool:
        return (
            request.method.upper() not in SAFE_METHODS
            and request.url.path.startswith(settings.API_V1_STR)
            and bool(
                request.cookies.get(settings.AUTH_COOKIE_NAME)
                or request.cookies.get(settings.REFRESH_COOKIE_NAME)
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

        request_origin = f"{request.url.scheme}://{request.url.netloc}"
        source_origin = f"{parsed_source.scheme}://{parsed_source.netloc}"
        allowed_origins = {str(origin).rstrip("/") for origin in settings.BACKEND_CORS_ORIGINS}
        allowed_origins.add(request_origin)
        if source_origin in allowed_origins:
            return True

        return settings.DEBUG and self._is_loopback_dev_origin(request, parsed_source)

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
        trace_id = set_trace_id(request_id)

        should_log = request.url.path not in HEALTH_PATHS
        if should_log:
            logger.info(
                f"REQUEST {request.method} {request.url.path} | "
                f"Client: {request.client.host if request.client else 'unknown'}"
            )

        try:
            response = await call_next(request)

            # Measure request duration.
            process_time = time.time() - start_time

            # Escalate log level for error responses.
            if response.status_code >= 500:
                log_func = logger.error
                status_label = "ERROR"
            elif response.status_code >= 400:
                log_func = logger.warning
                status_label = "WARN"
            else:
                log_func = logger.info
                status_label = "OK"

            # Log the response result.
            if should_log:
                log_func(
                    f"{status_label} {request.method} {request.url.path} | "
                    f"Status: {response.status_code} | "
                    f"Time: {process_time:.3f}s"
                )

            # Return trace metadata to the caller.
            response.headers["X-Request-ID"] = trace_id
            response.headers["X-Process-Time"] = f"{process_time:.3f}"

            return response

        except Exception as e:
            process_time = time.time() - start_time
            logger.error(
                f"EXCEPTION {request.method} {request.url.path} | "
                f"Error: {str(e)} | "
                f"Time: {process_time:.3f}s"
            )
            raise
