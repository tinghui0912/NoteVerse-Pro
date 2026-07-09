"""Authentication service layer for the auth module."""

from __future__ import annotations

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core import security
from app.core.exceptions import AuthenticationException
from app.db.model_utils import require_persisted_id
from app.db.models.user import User
from app.modules.auth.sessions_service import SessionService
from app.shared.constants import ErrorCode


class AuthService:
    """Encapsulate login and session creation."""

    def __init__(self, session_service: SessionService | None = None) -> None:
        self.session_service = session_service or SessionService()

    async def login(
        self,
        db: AsyncSession,
        email: str,
        password: str,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
        device_id: str | None = None,
    ) -> tuple[str, str]:
        normalized_email = email.strip().lower()
        result = await db.exec(select(User).where(User.email == normalized_email))
        user = result.one_or_none()

        if not user or not security.verify_password(password, user.password_hash):
            raise AuthenticationException(
                code=ErrorCode.INVALID_CREDENTIALS,
                details={"email": normalized_email},
            )
        if not user.is_active:
            raise AuthenticationException(
                code=ErrorCode.ACCOUNT_INACTIVE,
                details={"email": user.email},
            )
        access_token, refresh_token, _ = await self.session_service.create_token_pair(
            db,
            require_persisted_id(user.id, entity="user"),
            user_agent=user_agent,
            ip_address=ip_address,
            device_id=device_id,
        )
        await db.commit()
        return access_token, refresh_token
