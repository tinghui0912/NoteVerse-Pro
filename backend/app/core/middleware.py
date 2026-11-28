"""HTTP request lifecycle logging and metrics."""

import time
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.platform.security.client_ip import client_ip
from app.core.logger import logger
from app.core.request_correlation import request_correlation_id
from app.core.metrics import record_http_request
from app.core.tracing import capture_current_trace_context

HEALTH_PATHS = {"/health/live", "/health/ready", "/metrics"}


class LoggingMiddleware(BaseHTTPMiddleware):
    """Log request lifecycle events and attach tracing headers."""

    def __init__(
        self, app, *, trusted_proxy_cidrs: tuple[str, ...], trusted_proxy_hops: int = 0
    ) -> None:
        super().__init__(app)
        self.trusted_proxy_cidrs = trusted_proxy_cidrs
        self.trusted_proxy_hops = trusted_proxy_hops

    async def dispatch(self, request: Request, call_next):
        # Record the start time for latency logging.
        start_time = time.time()

        request_id = request_correlation_id(request)
        capture_current_trace_context()

        should_log = request.url.path not in HEALTH_PATHS
        base_log = logger.bind(
            event="api.request",
            request_id=request_id,
            method=request.method,
            http_path=request.url.path,
            peer_address=request.client.host if request.client else "unknown",
            client_address=client_ip(
                request.scope,
                trusted_proxy_cidrs=self.trusted_proxy_cidrs,
                trusted_proxy_hops=self.trusted_proxy_hops,
            )
            or "unknown",
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
