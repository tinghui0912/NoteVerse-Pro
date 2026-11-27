"""Authentication service layer for the auth module."""

from __future__ import annotations

from dataclasses import dataclass

from sqlmodel import select
from sqlalchemy.orm import Session

from app.core import security
from app.core.exceptions import AuthenticationException
from app.db.model_utils import require_persisted_id
from app.db.models.user import User
from app.modules.auth.sessions_service import SessionService
from app.modules.account.schemas import ProfileUserRead
from app.modules.account.profile_service import ProfileService
from app.shared.error_codes import CustomerErrorCode


@dataclass(frozen=True)
class LoginResult:
    access_token: str
    refresh_token: str
    principal: ProfileUserRead


class AuthService:
    """Encapsulate login and session creation."""

    def __init__(self, session_service: SessionService | None = None) -> None:
        self.session_service = session_service or SessionService()

    def login(
        self,
        db: Session,
        email: str,
        password: str,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
        device_id: str | None = None,
    ) -> LoginResult:
        normalized_email = email.strip().lower()
        result = db.execute(select(User).where(User.email == normalized_email))
        user = result.scalars().one_or_none()

        if not user or not security.verify_password(password, user.password_hash):
            raise AuthenticationException(
                code=CustomerErrorCode.INVALID_CREDENTIALS,
                details={"email": normalized_email},
            )
        if not user.is_active or user.deleted_at is not None:
            raise AuthenticationException(
                code=CustomerErrorCode.ACCOUNT_INACTIVE,
                details={"email": user.email},
            )
        access_token, refresh_token, _ = self.session_service.create_token_pair(
            db,
            require_persisted_id(user.id, entity="user"),
            user_agent=user_agent,
            ip_address=ip_address,
            device_id=device_id,
        )
        principal = ProfileService().profile_payload(user).user
        db.commit()
        return LoginResult(access_token, refresh_token, principal)
