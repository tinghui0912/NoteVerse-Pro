from __future__ import annotations

from datetime import datetime, timezone

import jwt
from pydantic import ValidationError
from sqlmodel import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import WebSocket

from app.shared.constants import ErrorCode
from app.core.config import settings
from app.core.exceptions import AuthenticationException, ResourceNotFoundException
from app.core.token_constants import TOKEN_ALGORITHM
from app.db.models import User
from app.modules.auth.schemas import TokenPayload
from app.modules.practice.service import PracticeService


def get_practice_service() -> PracticeService:
    """Provide the practice service from the practice module boundary."""
    return PracticeService()


async def get_websocket_current_user(
    websocket: WebSocket,
    db: AsyncSession,
) -> User:
    """Resolve the authenticated websocket user from the HttpOnly session cookie."""

    token: str | None = websocket.cookies.get(settings.AUTH_COOKIE_NAME)

    if not token:
        raise AuthenticationException(
            code=ErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "missing_token"},
        )

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[TOKEN_ALGORITHM])
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

    result = await db.execute(select(User).where(User.id == user_id))
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


__all__ = ["get_practice_service", "get_websocket_current_user"]
