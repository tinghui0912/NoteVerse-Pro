"""Consumer host-only session cookie transport."""

from fastapi import Response
from app.platform.config.customer_session_security import CustomerSessionSecuritySettings
from app.platform.security.cookies import set_session_cookie, clear_session_cookie


def set_auth_session_cookie(
    response: Response, token: str, *, config: CustomerSessionSecuritySettings
) -> None:
    set_session_cookie(
        response,
        token,
        secure_cookies=config.AUTH_COOKIE_SECURE,
        max_age=config.SESSION_ABSOLUTE_DAYS * 86400,
    )


def clear_auth_session_cookie(
    response: Response, *, config: CustomerSessionSecuritySettings
) -> None:
    clear_session_cookie(response, secure_cookies=config.AUTH_COOKIE_SECURE)
