"""Authentication service layer for the auth module."""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from urllib.parse import urlencode

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.exceptions import (
    AuthenticationException,
    ResourceAlreadyExistsException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models.auth import AuthToken, RefreshToken
from app.db.models.user import User
from app.modules.auth.email_templates import (
    build_email_verification_email,
    build_password_changed_email,
    build_password_reset_email,
)
from app.modules.auth.schemas import (
    ForgotPasswordRequest,
    RegisterRequest,
    ResetPasswordRequest,
    VerifyEmailRequest,
)
from app.modules.mail.outbox_service import queue_mail
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive

AUTH_TOKEN_EMAIL_VERIFICATION = "email_verification"
AUTH_TOKEN_PASSWORD_RESET = "password_reset"


class AuthService:
    """Encapsulate authentication and account recovery workflows."""

    def _hash_token(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _new_refresh_token(self) -> str:
        return secrets.token_urlsafe(48)

    def _new_auth_token(self) -> str:
        return secrets.token_urlsafe(48)

    def _frontend_url(self, path: str, token: str) -> str:
        base_url = settings.FRONTEND_BASE_URL.rstrip("/")
        return f"{base_url}{path}?{urlencode({'token': token})}"

    async def _create_auth_token(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        purpose: str,
        ttl_seconds: int,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> str:
        now = utc_now_naive()
        used_at_column = AuthToken.__table__.c.used_at
        result = await db.exec(
            select(AuthToken).where(
                AuthToken.user_id == user_id,
                AuthToken.purpose == purpose,
                used_at_column.is_(None),
            )
        )
        for existing in result.all():
            existing.used_at = now

        token = self._new_auth_token()
        db.add(
            AuthToken(
                user_id=user_id,
                purpose=purpose,
                token_hash=self._hash_token(token),
                user_agent=user_agent,
                ip_address=ip_address,
                expires_at=now + timedelta(seconds=ttl_seconds),
            )
        )
        await db.flush()
        return token

    async def _consume_auth_token(
        self,
        db: AsyncSession,
        token: str,
        *,
        purpose: str,
        field: str,
    ) -> AuthToken:
        result = await db.exec(
            select(AuthToken).where(
                AuthToken.token_hash == self._hash_token(token),
                AuthToken.purpose == purpose,
            )
        )
        record = result.one_or_none()
        now = utc_now_naive()

        if not record or record.used_at is not None or record.expires_at <= now:
            raise ValidationException(
                code=(
                    ErrorCode.RESET_TOKEN_INVALID
                    if purpose == AUTH_TOKEN_PASSWORD_RESET
                    else ErrorCode.TOKEN_INVALID_EXPIRED
                ),
                field=field,
            )

        record.used_at = now
        await db.flush()
        return record

    async def _create_token_pair(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
        device_id: str | None = None,
    ) -> tuple[str, str, RefreshToken]:
        access_token = security.create_access_token(
            user_id,
            expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        refresh_token = self._new_refresh_token()
        record = RefreshToken(
            user_id=user_id,
            token_hash=self._hash_token(refresh_token),
            device_id=device_id,
            user_agent=user_agent,
            ip_address=ip_address,
            expires_at=utc_now_naive() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
        db.add(record)
        await db.flush()
        return access_token, refresh_token, record

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
        if user.email_verified_at is None:
            raise AuthenticationException(
                code=ErrorCode.EMAIL_NOT_VERIFIED,
                details={"email": user.email},
            )

        access_token, refresh_token, _ = await self._create_token_pair(
            db,
            require_persisted_id(user.id, entity="user"),
            user_agent=user_agent,
            ip_address=ip_address,
            device_id=device_id,
        )
        await db.commit()
        return access_token, refresh_token

    async def refresh_session(
        self,
        db: AsyncSession,
        refresh_token: str,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
        device_id: str | None = None,
    ) -> tuple[str, str]:
        token_hash = self._hash_token(refresh_token)
        result = await db.exec(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        current_token = result.one_or_none()
        now = utc_now_naive()

        if not current_token:
            raise AuthenticationException(
                code=ErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "refresh_not_found"},
            )
        if current_token.revoked_at is not None:
            raise AuthenticationException(
                code=ErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "refresh_revoked"},
            )
        if current_token.expires_at <= now:
            raise AuthenticationException(
                code=ErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "refresh_expired"},
            )

        result = await db.exec(select(User).where(User.id == current_token.user_id))
        user = result.one_or_none()
        if not user or not user.is_active or user.email_verified_at is None:
            current_token.revoked_at = now
            await db.commit()
            raise AuthenticationException(
                code=ErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "user_inactive_missing_or_unverified"},
            )

        if user.password_changed_at and current_token.created_at <= user.password_changed_at:
            current_token.revoked_at = now
            await db.commit()
            raise AuthenticationException(
                code=ErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "password_changed"},
            )

        current_token.revoked_at = now
        current_token.last_used_at = now
        access_token, next_refresh_token, next_record = await self._create_token_pair(
            db,
            require_persisted_id(user.id, entity="user"),
            user_agent=user_agent or current_token.user_agent,
            ip_address=ip_address or current_token.ip_address,
            device_id=device_id or current_token.device_id,
        )
        current_token.replaced_by_token_id = require_persisted_id(
            next_record.id, entity="refresh_token"
        )
        await db.commit()
        return access_token, next_refresh_token

    async def revoke_refresh_token(self, db: AsyncSession, refresh_token: str | None) -> None:
        if not refresh_token:
            return
        result = await db.exec(
            select(RefreshToken).where(RefreshToken.token_hash == self._hash_token(refresh_token))
        )
        record = result.one_or_none()
        if record and record.revoked_at is None:
            record.revoked_at = utc_now_naive()
            await db.commit()

    async def revoke_user_refresh_tokens(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        revoked_at=None,
        commit: bool = True,
    ) -> None:
        now = revoked_at or utc_now_naive()
        revoked_at_column = RefreshToken.__table__.c.revoked_at
        result = await db.exec(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id,
                revoked_at_column.is_(None),
            )
        )
        for record in result.all():
            record.revoked_at = now
        if commit:
            await db.commit()

    async def register(
        self,
        db: AsyncSession,
        request: RegisterRequest,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> User:
        email = str(request.email).strip().lower()
        result = await db.exec(select(User).where(User.email == email))
        if result.one_or_none():
            raise ResourceAlreadyExistsException(
                resource_type="user",
                details={"email": email},
            )

        user = User(
            email=email,
            display_name=request.display_name,
            password_hash=security.get_password_hash(request.password),
            is_active=True,
            email_verified_at=None,
        )
        db.add(user)
        await db.flush()

        user_id = require_persisted_id(user.id, entity="user")
        ttl_seconds = settings.EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS
        token = await self._create_auth_token(
            db,
            user_id,
            purpose=AUTH_TOKEN_EMAIL_VERIFICATION,
            ttl_seconds=ttl_seconds,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        email_content = build_email_verification_email(
            locale=request.locale,
            project_name=settings.PROJECT_NAME,
            verification_url=self._frontend_url("/auth/verify-email", token),
            ttl_seconds=ttl_seconds,
        )
        await queue_mail(
            db,
            category="verification.email",
            dedupe_key=f"verification.email:{user_id}:{self._hash_token(token)}",
            recipient=email,
            subject=email_content.subject,
            text_body=email_content.text_body,
            html_body=email_content.html_body,
            expires_at=utc_now_naive() + timedelta(seconds=ttl_seconds),
        )
        await db.commit()
        await db.refresh(user)
        return user

    async def verify_email(self, db: AsyncSession, request: VerifyEmailRequest) -> User:
        token_record = await self._consume_auth_token(
            db,
            request.token,
            purpose=AUTH_TOKEN_EMAIL_VERIFICATION,
            field="token",
        )
        result = await db.exec(select(User).where(User.id == token_record.user_id))
        user = result.one_or_none()
        if not user:
            raise ValidationException(code=ErrorCode.TOKEN_INVALID_EXPIRED, field="token")

        if user.email_verified_at is None:
            user.email_verified_at = utc_now_naive()
        await db.commit()
        await db.refresh(user)
        return user

    async def request_password_reset(
        self,
        db: AsyncSession,
        request: ForgotPasswordRequest,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> None:
        email = str(request.email).strip().lower()
        result = await db.exec(select(User).where(User.email == email))
        user = result.one_or_none()
        if not user or not user.is_active or user.email_verified_at is None:
            return

        user_id = require_persisted_id(user.id, entity="user")
        ttl_seconds = settings.EMAIL_PASSWORD_RESET_TOKEN_TTL_SECONDS
        token = await self._create_auth_token(
            db,
            user_id,
            purpose=AUTH_TOKEN_PASSWORD_RESET,
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
        await queue_mail(
            db,
            category="password.reset.requested",
            dedupe_key=f"password.reset:{user_id}:{self._hash_token(token)}",
            recipient=email,
            subject=email_content.subject,
            text_body=email_content.text_body,
            html_body=email_content.html_body,
            expires_at=utc_now_naive() + timedelta(seconds=ttl_seconds),
        )
        await db.commit()

    async def reset_password(
        self,
        db: AsyncSession,
        request: ResetPasswordRequest,
    ) -> None:
        token_record = await self._consume_auth_token(
            db,
            request.token,
            purpose=AUTH_TOKEN_PASSWORD_RESET,
            field="token",
        )
        result = await db.exec(select(User).where(User.id == token_record.user_id))
        user = result.one_or_none()
        if not user:
            raise ValidationException(code=ErrorCode.RESET_TOKEN_INVALID, field="token")

        user.password_hash = security.get_password_hash(request.new_password)
        changed_at = utc_now_naive()
        user.password_changed_at = changed_at
        await self.revoke_user_refresh_tokens(
            db,
            require_persisted_id(user.id, entity="user"),
            revoked_at=changed_at,
            commit=False,
        )

        email_content = build_password_changed_email(
            locale=request.locale,
            project_name=settings.PROJECT_NAME,
        )
        await queue_mail(
            db,
            category="password.reset.completed",
            dedupe_key=f"password.reset.completed:{require_persisted_id(user.id, entity='user')}:{changed_at.isoformat()}",
            recipient=user.email,
            subject=email_content.subject,
            text_body=email_content.text_body,
            html_body=email_content.html_body,
        )
        await db.commit()
