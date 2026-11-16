"""Password reset workflow for the auth module."""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from urllib.parse import urlencode

from sqlmodel import select
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.exceptions import ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models.auth import AuthToken
from app.db.models.user import User
from app.modules.auth.schemas import ForgotPasswordRequest, ResetPasswordRequest
from app.modules.auth.sessions_service import SessionService
from app.modules.mail.outbox_service import queue_mail
from app.modules.mail.templates.auth import (
    build_password_changed_email,
    build_password_reset_email,
)
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now

AUTH_TOKEN_PASSWORD_RESET = "password_reset"


class PasswordResetService:
    """Owns password reset tokens, recovery emails, and reset completion."""

    def __init__(self, session_service: SessionService | None = None) -> None:
        self.session_service = session_service or SessionService()

    def _hash_token(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _new_token(self) -> str:
        return secrets.token_urlsafe(48)

    def _frontend_url(self, path: str, token: str) -> str:
        base_url = settings.FRONTEND_BASE_URL.rstrip("/")
        return f"{base_url}{path}?{urlencode({'token': token})}"

    def _create_token(
        self,
        db: Session,
        user_id: int,
        *,
        ttl_seconds: int,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> str:
        now = utc_now()
        used_at_column = AuthToken.__table__.c.used_at
        result = db.execute(
            select(AuthToken).where(
                AuthToken.user_id == user_id,
                AuthToken.purpose == AUTH_TOKEN_PASSWORD_RESET,
                used_at_column.is_(None),
            )
        )
        for existing in result.scalars().all():
            existing.used_at = now

        token = self._new_token()
        db.add(
            AuthToken(
                user_id=user_id,
                purpose=AUTH_TOKEN_PASSWORD_RESET,
                token_hash=self._hash_token(token),
                user_agent=user_agent,
                ip_address=ip_address,
                expires_at=now + timedelta(seconds=ttl_seconds),
            )
        )
        db.flush()
        return token

    def _consume_token(self, db: Session, token: str) -> AuthToken:
        result = db.execute(
            select(AuthToken).where(
                AuthToken.token_hash == self._hash_token(token),
                AuthToken.purpose == AUTH_TOKEN_PASSWORD_RESET,
            )
        )
        record = result.scalars().one_or_none()
        now = utc_now()

        if not record or record.used_at is not None or record.expires_at <= now:
            raise ValidationException(code=CustomerErrorCode.RESET_TOKEN_INVALID, field="token")

        record.used_at = now
        db.flush()
        return record

    def request_password_reset(
        self,
        db: Session,
        request: ForgotPasswordRequest,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> None:
        email = str(request.email).strip().lower()
        result = db.execute(select(User).where(User.email == email))
        user = result.scalars().one_or_none()
        if not user or not user.is_active:
            return

        user_id = require_persisted_id(user.id, entity="user")
        ttl_seconds = settings.EMAIL_PASSWORD_RESET_TOKEN_TTL_SECONDS
        token = self._create_token(
            db,
            user_id,
            ttl_seconds=ttl_seconds,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        email_content = build_password_reset_email(
            locale=request.locale,
            project_name=settings.PROJECT_NAME,
            reset_url=self._frontend_url("/auth/reset-password", token),
            ttl_seconds=ttl_seconds,
        )
        queue_mail(
            db,
            category="password.reset.requested",
            dedupe_key=f"password.reset:{user_id}:{self._hash_token(token)}",
            recipient=email,
            subject=email_content.subject,
            text_body=email_content.text_body,
            html_body=email_content.html_body,
            expires_at=utc_now() + timedelta(seconds=ttl_seconds),
        )
        db.commit()

    def reset_password(
        self,
        db: Session,
        request: ResetPasswordRequest,
    ) -> None:
        token_record = self._consume_token(db, request.token)
        result = db.execute(select(User).where(User.id == token_record.user_id))
        user = result.scalars().one_or_none()
        if not user:
            raise ValidationException(code=CustomerErrorCode.RESET_TOKEN_INVALID, field="token")

        user.password_hash = security.get_password_hash(request.new_password)
        changed_at = utc_now()
        user.password_changed_at = changed_at
        user_id = require_persisted_id(user.id, entity="user")
        self.session_service.revoke_user_refresh_tokens(
            db,
            user_id,
            revoked_at=changed_at,
            commit=False,
        )

        email_content = build_password_changed_email(
            locale=request.locale,
            project_name=settings.PROJECT_NAME,
        )
        queue_mail(
            db,
            category="password.reset.completed",
            dedupe_key=f"password.reset.completed:{user_id}:{changed_at.isoformat()}",
            recipient=user.email,
            subject=email_content.subject,
            text_body=email_content.text_body,
            html_body=email_content.html_body,
        )
        db.commit()
