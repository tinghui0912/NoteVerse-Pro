"""Process-local request correlation with explicit binding lifetime."""

from contextvars import ContextVar
from dataclasses import dataclass


@dataclass
class RequestCorrelation:
    request_id: str
    active: bool = True


request_correlation: ContextVar[RequestCorrelation | None] = ContextVar(
    "request_correlation", default=None
)


def get_request_id() -> str | None:
    """Read ambient HTTP correlation only while its owning request is active."""
    context = request_correlation.get()
    return context.request_id if context is not None and context.active else None
