"""Operator session policy values, independent of environment loading."""

from dataclasses import dataclass
from app.core.generated.control_plane_browser_protocol import (
    OPERATOR_AUTH_COOKIE_NAME,
    OPERATOR_CSRF_COOKIE_NAME,
    OPERATOR_CSRF_HEADER_NAME,
)


@dataclass(frozen=True, slots=True)
class OperatorSessionConfig:
    cookie_secure: bool
    cookie_samesite: str
    session_expire_minutes: int
    cors_origins: tuple[str, ...]

    @property
    def auth_cookie_name(self) -> str:
        return OPERATOR_AUTH_COOKIE_NAME

    @property
    def csrf_cookie_name(self) -> str:
        return OPERATOR_CSRF_COOKIE_NAME

    @property
    def csrf_header_name(self) -> str:
        return OPERATOR_CSRF_HEADER_NAME
