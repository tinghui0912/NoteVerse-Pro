"""Host-only Strict cookies isolate MFA challenges from authenticated operator sessions."""

from fastapi import Response
from app.platform.config.operator_session import OperatorSessionConfig
from app.platform.security.opaque_tokens import generate_token


def _set(
    response: Response,
    name: str,
    value: str,
    security: OperatorSessionConfig,
    *,
    max_age: int,
    httponly: bool = True,
) -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        secure=security.cookie_secure,
        httponly=httponly,
        samesite="strict",
        path="/",
        domain=None,
    )


def clear_challenge_cookie(response: Response, security: OperatorSessionConfig) -> None:
    response.delete_cookie(
        security.challenge_cookie_name,
        secure=security.cookie_secure,
        httponly=True,
        samesite="strict",
        path="/",
        domain=None,
    )


def set_challenge_cookie(response: Response, token: str, security: OperatorSessionConfig) -> None:
    clear_control_plane_session_cookies(response, security=security)
    _set(response, security.challenge_cookie_name, token, security, max_age=300)
    _set(
        response, security.csrf_cookie_name, generate_token(), security, max_age=300, httponly=False
    )


def set_control_plane_session_cookies(
    response: Response, *, session_token: str, security: OperatorSessionConfig
) -> None:
    clear_challenge_cookie(response, security)
    _set(response, security.auth_cookie_name, session_token, security, max_age=43200)
    _set(
        response,
        security.csrf_cookie_name,
        generate_token(),
        security,
        max_age=43200,
        httponly=False,
    )


def clear_control_plane_session_cookies(
    response: Response, *, security: OperatorSessionConfig
) -> None:
    for name, httponly in ((security.auth_cookie_name, True), (security.csrf_cookie_name, False)):
        response.delete_cookie(
            name,
            secure=security.cookie_secure,
            httponly=httponly,
            samesite="strict",
            path="/",
            domain=None,
        )
    clear_challenge_cookie(response, security)
