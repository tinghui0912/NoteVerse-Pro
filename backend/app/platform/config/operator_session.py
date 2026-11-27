"""Control Plane cookie, encryption and lifetime policy values."""

from dataclasses import dataclass
from app.core.generated.control_plane_browser_protocol import (
    OPERATOR_AUTH_COOKIE_NAME,
    OPERATOR_SECURE_AUTH_COOKIE_NAME,
    OPERATOR_CHALLENGE_COOKIE_NAME,
    OPERATOR_SECURE_CHALLENGE_COOKIE_NAME,
)


@dataclass(frozen=True, slots=True)
class OperatorSessionConfig:
    cookie_secure: bool
    encryption_key: str
    cors_origins: tuple[str, ...]

    @property
    def auth_cookie_name(self) -> str:
        return OPERATOR_SECURE_AUTH_COOKIE_NAME if self.cookie_secure else OPERATOR_AUTH_COOKIE_NAME

    @property
    def challenge_cookie_name(self) -> str:
        return (
            OPERATOR_SECURE_CHALLENGE_COOKIE_NAME
            if self.cookie_secure
            else OPERATOR_CHALLENGE_COOKIE_NAME
        )
