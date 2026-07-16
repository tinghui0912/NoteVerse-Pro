"""Prometheus metrics for API and worker observability."""

from __future__ import annotations

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest


HTTP_REQUESTS_TOTAL = Counter(
    "noteverse_http_requests_total",
    "Total HTTP requests handled by the API.",
    ("method", "route", "status_code"),
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "noteverse_http_request_duration_seconds",
    "HTTP request duration in seconds.",
    ("method", "route", "status_code"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

REALTIME_ACTIVE_CONNECTIONS = Gauge(
    "noteverse_realtime_active_connections",
    "Active realtime connections by channel.",
    ("channel",),
)

REALTIME_ACTIVE_CONNECTIONS.labels("app_sse").set(0)
REALTIME_ACTIVE_CONNECTIONS.labels("practice_websocket").set(0)


def normalize_route_label(path: str | None) -> str:
    """Return a bounded-cardinality route label for metrics."""

    if not path:
        return "unknown"
    return path


def record_http_request(
    *,
    method: str,
    route: str | None,
    status_code: int,
    duration_seconds: float,
) -> None:
    """Record an HTTP request outcome."""

    labels = (method, normalize_route_label(route), str(status_code))
    HTTP_REQUESTS_TOTAL.labels(*labels).inc()
    HTTP_REQUEST_DURATION_SECONDS.labels(*labels).observe(duration_seconds)


def metrics_content() -> bytes:
    """Render all registered Prometheus metrics."""

    return generate_latest()


def realtime_connection_opened(*, channel: str) -> None:
    """Record a realtime connection opening."""

    REALTIME_ACTIVE_CONNECTIONS.labels(channel).inc()


def realtime_connection_closed(*, channel: str) -> None:
    """Record a realtime connection closing."""

    REALTIME_ACTIVE_CONNECTIONS.labels(channel).dec()


__all__ = [
    "CONTENT_TYPE_LATEST",
    "metrics_content",
    "record_http_request",
    "realtime_connection_closed",
    "realtime_connection_opened",
]
