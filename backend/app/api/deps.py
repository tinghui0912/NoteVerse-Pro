"""Shared API dependency surface.

This file is canonical only for authentication and database access.
Feature-specific dependency logic belongs in `app.modules.<feature>.dependencies`.
"""

from collections.abc import AsyncGenerator

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.shared.constants import ErrorCode
from app.core import security
from app.core.config import settings
from app.core.exceptions import (
    AuthenticationException,
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.session import get_session
from app.db.models.user import User, UserRole
from app.modules.auth.schemas import TokenPayload

reusable_oauth2 = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_session():
        yield session


async def get_current_user(
    session: AsyncSession = Depends(get_db),
    token: str = Depends(reusable_oauth2),
) -> User:
    """Resolve the authenticated user from the bearer token."""
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[security.ALGORITHM],
        )
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

    result = await session.execute(select(User).where(User.id == int(token_data.sub)))
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


async def get_current_active_superuser(
    current_user: User = Depends(get_current_user),
) -> User:
    """Require an authenticated admin user."""
    if current_user.role != UserRole.admin:
        raise UnauthorizedException(
            code=ErrorCode.NO_ACCESS,
            details={
                "required_role": UserRole.admin.value,
                "current_role": current_user.role.value,
            },
        )
    return current_user
