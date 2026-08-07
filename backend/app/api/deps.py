"""Shared API dependency surface.

This file is canonical only for authentication and database access.
Feature-specific dependency logic belongs in `app.modules.<feature>.dependencies`.
"""

from collections.abc import AsyncGenerator
from datetime import datetime, timezone

import jwt
from fastapi import Cookie, Depends
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.shared.constants import ErrorCode
from app.core import security
from app.core.config import settings
from app.core.exceptions import (
    AuthenticationException,
    ExternalServiceException,
    ResourceNotFoundException,
)
from app.db.session import get_session
from app.db.models.user import User
from app.modules.auth.schemas import TokenPayload

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_session():
        yield session


async def get_current_user(
    session: AsyncSession = Depends(get_db),
    session_cookie: str | None = Cookie(
        default=None,
        alias=settings.AUTH_COOKIE_NAME,
    ),
) -> User:
    """Resolve the authenticated user from the HttpOnly session cookie."""
    token = session_cookie
    if not token:
        raise AuthenticationException(
            code=ErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "missing_token"},
        )

    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[security.ALGORITHM],
        )
        token_data = TokenPayload(**payload)
    except (jwt.InvalidTokenError, ValidationError):
        raise AuthenticationException(
            code=ErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "invalid_token"},
        )

    if token_data.sub is None:
        raise AuthenticationException(
            code=ErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "missing_subject"},
        )
    if token_data.typ != "access":
        raise AuthenticationException(
            code=ErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "invalid_token_type"},
        )

    try:
        user_id = int(token_data.sub)
    except (TypeError, ValueError):
        raise AuthenticationException(
            code=ErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "invalid_subject"},
        )

    try:
        result = await session.execute(select(User).where(User.id == user_id))
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
        raise ResourceNotFoundException(
            resource_type="user",
            resource_id=str(token_data.sub),
            code=ErrorCode.USER_NOT_FOUND,
        )
    if not user.is_active:
        raise AuthenticationException(
            code=ErrorCode.ACCOUNT_INACTIVE,
            details={"user_id": user.id},
        )
    if user.password_changed_at and token_data.iat:
        token_issued_at = datetime.fromtimestamp(token_data.iat, timezone.utc).replace(tzinfo=None)
        if token_issued_at < user.password_changed_at:
            raise AuthenticationException(
                code=ErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "password_changed"},
            )
    return user


async def get_optional_current_user(
    session: AsyncSession = Depends(get_db),
    session_cookie: str | None = Cookie(
        default=None,
        alias=settings.AUTH_COOKIE_NAME,
    ),
) -> User | None:
    """Resolve an optional principal for exact anonymous access routes."""
    if not session_cookie:
        return None
    try:
        return await get_current_user(session, session_cookie)
    except AuthenticationException:
        return None
