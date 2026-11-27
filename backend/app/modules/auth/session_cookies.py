"""Consumer session and CSRF cookies share the session transport policy."""

from fastapi import Response
from app.platform.config.customer_session_security import CustomerSessionSecuritySettings
from app.platform.security.cookies import set_session_cookie, clear_session_cookie
from app.platform.security.opaque_tokens import generate_token
from app.core.generated.customer_browser_protocol import CSRF_COOKIE_NAME


def set_session_cookies(
    response: Response, token: str, *, config: CustomerSessionSecuritySettings
) -> None:
    lifetime = config.SESSION_ABSOLUTE_DAYS * 86400
    set_session_cookie(response, token, secure_cookies=config.AUTH_COOKIE_SECURE, max_age=lifetime)
    response.set_cookie(
        CSRF_COOKIE_NAME,
        generate_token(),
        max_age=lifetime,
        secure=config.AUTH_COOKIE_SECURE,
        httponly=False,
        samesite="lax",
        path="/",
    )


def clear_session_cookies(response: Response, *, config: CustomerSessionSecuritySettings) -> None:
    clear_session_cookie(response, secure_cookies=config.AUTH_COOKIE_SECURE)
    response.delete_cookie(
        CSRF_COOKIE_NAME, secure=config.AUTH_COOKIE_SECURE, httponly=False, samesite="lax", path="/"
    )
