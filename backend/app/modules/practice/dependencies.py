from __future__ import annotations

from jose import JWTError, jwt
from pydantic import ValidationError
from sqlmodel import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import WebSocket

from app.shared.constants import ErrorCode
from app.core import security
from app.core.config import settings
from app.core.exceptions import AuthenticationException, ResourceNotFoundException
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
    """Resolve the authenticated websocket user from a bearer token or query token."""

    auth_header = websocket.headers.get("authorization", "")
    token: str | None = None
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()

    if not token:
        token = websocket.query_params.get("token")

    if not token:
        raise AuthenticationException(
            code=ErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "missing_token"},
        )

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[security.ALGORITHM])
        token_data = TokenPayload(**payload)
    except (JWTError, ValidationError):
        raise AuthenticationException(
            code=ErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "invalid_token"},
        )

    if token_data.sub is None:
        raise AuthenticationException(
            code=ErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "missing_subject"},
        )

    result = await db.execute(select(User).where(User.id == int(token_data.sub)))
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
    return user


__all__ = ["get_practice_service", "get_websocket_current_user"]
