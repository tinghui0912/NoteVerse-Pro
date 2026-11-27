"""Error values supplied by each HTTP composition root."""

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum

ErrorResponseFactory = Callable[[StrEnum, str], dict[str, object]]


@dataclass(frozen=True)
class HttpRuntimeErrorCodes:
    validation_error: StrEnum
    auth_failed: StrEnum
    unauthorized: StrEnum
    resource_not_found: StrEnum
    internal_error: StrEnum
    unknown_error: StrEnum
    unsupported_media_type: StrEnum
    rate_limit_exceeded: StrEnum
    rate_limit_unavailable: StrEnum
    request_origin_invalid: StrEnum


class RateLimitHttpException(Exception):
    """HTTP admission failure has an explicit status and retry delay."""

    def __init__(self, *, status_code: int, retry_after_seconds: int):
        self.status_code = status_code
        self.retry_after_seconds = retry_after_seconds
