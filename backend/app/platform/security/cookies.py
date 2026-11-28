"""Host-only HttpOnly session cookies with fixed transport attributes."""

from starlette.responses import Response
from app.core.generated.customer_browser_protocol import AUTH_COOKIE_NAME, SECURE_AUTH_COOKIE_NAME


def session_cookie_name(secure_cookies: bool) -> str:
    return SECURE_AUTH_COOKIE_NAME if secure_cookies else AUTH_COOKIE_NAME


def set_session_cookie(
    response: Response, token: str, *, secure_cookies: bool, max_age: int
) -> None:
    response.set_cookie(
        session_cookie_name(secure_cookies),
        token,
        max_age=max_age,
        secure=secure_cookies,
        httponly=True,
        samesite="lax",
        path="/",
        domain=None,
    )


def clear_session_cookie(response: Response, *, secure_cookies: bool) -> None:
    response.delete_cookie(
        session_cookie_name(secure_cookies),
        secure=secure_cookies,
        httponly=True,
        samesite="lax",
        path="/",
        domain=None,
    )
