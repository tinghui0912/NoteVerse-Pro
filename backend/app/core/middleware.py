"""HTTP middleware used by the FastAPI application."""

import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logger import logger, set_trace_id


class LoggingMiddleware(BaseHTTPMiddleware):
    """Log request lifecycle events and attach tracing headers."""

    async def dispatch(self, request: Request, call_next):
        # Record the start time for latency logging.
        start_time = time.time()

        # Use an incoming request ID when present, otherwise generate one.
        request_id = request.headers.get("X-Request-ID")
        trace_id = set_trace_id(request_id)

        # Log the incoming request.
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
