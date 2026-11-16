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
    csrf_token_invalid: StrEnum
    request_origin_invalid: StrEnum
