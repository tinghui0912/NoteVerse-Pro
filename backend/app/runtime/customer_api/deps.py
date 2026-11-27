"""Customer authentication context and request-scoped policy dependencies."""

from datetime import datetime, timezone

import jwt
from fastapi import Cookie, Depends
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlmodel import select

from app.core.generated.customer_browser_protocol import AUTH_COOKIE_NAME
from app.shared.error_codes import CustomerErrorCode
from app.core import security

from app.core.exceptions import (
    AuthenticationException,
    ExternalServiceException,
)
from app.platform.db.dependencies import get_db
from fastapi import Request
from app.runtime.customer_api.settings import CustomerApiSettings
from app.db.models.user import User
from app.modules.auth.schemas import TokenPayload


def get_current_user(
    request: Request,
    session: Session = Depends(get_db, scope="function"),
    session_cookie: str | None = Cookie(
        default=None,
        alias=AUTH_COOKIE_NAME,
    ),
) -> User:
    """Resolve the authenticated user from the HttpOnly session cookie."""
    token = session_cookie
    if not token:
        raise AuthenticationException(
            code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "missing_token"},
        )

    try:
        payload = jwt.decode(
            token,
            request.app.state.settings.SECRET_KEY,
            algorithms=[security.ALGORITHM],
        )
        token_data = TokenPayload(**payload)
    except (jwt.InvalidTokenError, ValidationError):
        raise AuthenticationException(
            code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "invalid_token"},
        )

    if token_data.sub is None:
        raise AuthenticationException(
            code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "missing_subject"},
        )
    if token_data.typ != "access":
        raise AuthenticationException(
            code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "invalid_token_type"},
        )

    try:
        user_id = int(token_data.sub)
    except (TypeError, ValueError):
        raise AuthenticationException(
            code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "invalid_subject"},
        )

    try:
        result = session.execute(select(User).where(User.id == user_id))
    except (ConnectionRefusedError, SQLAlchemyError) as exc:
        raise ExternalServiceException(
            service="database",
            details={
                "operation": "get_current_user",
                "type": type(exc).__name__,
            },
        ) from exc

    user = result.scalars().first()

    if not user:
        raise AuthenticationException(
            code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "principal_missing"},
        )
    if not user.is_active or user.deleted_at is not None:
        raise AuthenticationException(
            code=CustomerErrorCode.ACCOUNT_INACTIVE,
            details={"user_id": user.id},
        )
    if user.password_changed_at and token_data.iat:
        token_issued_at = datetime.fromtimestamp(token_data.iat, timezone.utc)
        if token_issued_at < user.password_changed_at:
            raise AuthenticationException(
                code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "password_changed"},
            )
    return user


def get_optional_current_user(
    request: Request,
    session: Session = Depends(get_db, scope="function"),
    session_cookie: str | None = Cookie(
        default=None,
        alias=AUTH_COOKIE_NAME,
    ),
) -> User | None:
    """Resolve an optional principal for exact anonymous access routes."""
    if not session_cookie:
        return None
    try:
        return get_current_user(request, session, session_cookie)
    except AuthenticationException:
        return None


def get_settings(request: Request) -> CustomerApiSettings:
    return request.app.state.settings
