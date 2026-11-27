"""Host-only opaque-session cookies for the control-plane surface."""

import secrets

from fastapi import Response

from app.platform.config.operator_session import OperatorSessionConfig


def set_control_plane_session_cookies(
    response: Response,
    *,
    session_token: str,
    security: OperatorSessionConfig,
) -> None:
    max_age = security.session_expire_minutes * 60
    response.set_cookie(
        key=security.auth_cookie_name,
        value=session_token,
        max_age=max_age,
        httponly=True,
        secure=security.cookie_secure,
        samesite=security.cookie_samesite,
        path="/",
    )
    response.set_cookie(
        key=security.csrf_cookie_name,
        value=secrets.token_urlsafe(32),
        max_age=max_age,
        httponly=False,
        secure=security.cookie_secure,
        samesite=security.cookie_samesite,
        path="/",
    )


def clear_control_plane_session_cookies(
    response: Response, *, security: OperatorSessionConfig
) -> None:
    response.delete_cookie(
        key=security.auth_cookie_name,
        path="/",
        secure=security.cookie_secure,
        samesite=security.cookie_samesite,
        httponly=True,
    )
    response.delete_cookie(
        key=security.csrf_cookie_name,
        path="/",
        secure=security.cookie_secure,
        samesite=security.cookie_samesite,
        httponly=False,
    )
