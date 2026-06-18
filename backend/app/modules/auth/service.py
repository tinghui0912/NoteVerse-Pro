"""Authentication service layer for the auth module."""

from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import timedelta

import redis
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.exceptions import (
    AuthenticationException,
    ResourceAlreadyExistsException,
    ValidationException,
)
from app.db.models.user import User
from app.db.models.auth import RefreshToken
from app.db.model_utils import require_persisted_id
from app.modules.auth.schemas import (
    RegisterRequest,
    ResetPasswordRequest,
    SendCodeResult,
    SendCodeRequest,
    VerifyCodeRequest,
)
from app.shared.constants import ErrorCode
from app.shared.mail_dispatcher import dispatch_email
from app.utils.timezone import utc_now_naive

REDIS_KEY_VERIFY_PREFIX = "email_verify:"
REDIS_KEY_COOLDOWN_PREFIX = "email_cooldown:"


class AuthService:
    """Encapsulate authentication and email-verification workflows."""

    def __init__(self, redis_client: redis.Redis | None = None):
        self.redis_client = redis_client or redis.Redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
        )

    def _hash_code(self, code: str, email: str) -> str:
        base = f"{code}:{email}:{settings.SECRET_KEY}".encode("utf-8")
        return hashlib.sha256(base).hexdigest()

    def _hash_token(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _new_refresh_token(self) -> str:
        return secrets.token_urlsafe(48)

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
        result = await db.exec(select(User).where(User.email == email))
        user = result.one_or_none()

        if not user or not security.verify_password(password, user.password_hash):
            raise AuthenticationException(
                code=ErrorCode.INVALID_CREDENTIALS,
                details={"email": email},
            )
        if not user.is_active:
            raise AuthenticationException(
                code=ErrorCode.ACCOUNT_INACTIVE,
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
        if not user or not user.is_active:
            current_token.revoked_at = now
            await db.commit()
            raise AuthenticationException(
                code=ErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "user_inactive_or_missing"},
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
        current_token.replaced_by_token_id = require_persisted_id(next_record.id, entity="refresh_token")
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

    async def register(self, db: AsyncSession, request: RegisterRequest) -> User:
        try:
            payload = security.decode_token(request.verified_token)
            if payload.get("typ") != "email_verification":
                raise ValidationException(
                    code=ErrorCode.TOKEN_INVALID_EXPIRED,
                    field="verified_token",
                )
            token_email = str(payload.get("sub", "")).replace("verify:", "")
            if not token_email or token_email != request.email:
                raise ValidationException(
                    code=ErrorCode.EMAIL_MISMATCH,
                    field="verified_token",
                )
        except ValueError:
            raise ValidationException(
                code=ErrorCode.TOKEN_INVALID_EXPIRED,
                field="verified_token",
            )

        result = await db.exec(select(User).where(User.email == request.email))
        if result.one_or_none():
            raise ResourceAlreadyExistsException(
                resource_type="user",
                details={"email": request.email},
            )

        user = User(
            email=request.email,
            display_name=request.display_name,
            password_hash=security.get_password_hash(request.password),
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user

    def send_email_code(self, request: SendCodeRequest) -> SendCodeResult:
        email = request.email
        purpose = request.purpose

        cooldown_key = f"{REDIS_KEY_COOLDOWN_PREFIX}{email}"
        ttl = self.redis_client.ttl(cooldown_key)
        if ttl > 0:
            raise ValidationException(
                code=ErrorCode.REQUEST_TOO_FREQUENT,
                field="email",
                details={"seconds": ttl},
            )

        challenge_id = uuid.uuid4().hex
        code = f"{uuid.uuid4().int % 1000000:06d}"
        code_hash = self._hash_code(code, email)

        payload = {"email": email, "code_hash": code_hash, "purpose": purpose}
        self.redis_client.setex(
            f"{REDIS_KEY_VERIFY_PREFIX}{challenge_id}",
            settings.EMAIL_CODE_TTL_SECONDS,
            json.dumps(payload),
        )
        self.redis_client.setex(
            cooldown_key,
            settings.EMAIL_CODE_COOLDOWN_SECONDS,
            "1",
        )

        if purpose == "password_reset":
            subject = f"{settings.PROJECT_NAME} Password Reset Code"
            body = (
                f"Your password reset code is: {code}\n"
                f"This code will expire in {settings.EMAIL_CODE_TTL_SECONDS // 60} minutes.\n"
                "If you did not request this, ignore this email."
            )
        elif purpose == "register":
            subject = f"{settings.PROJECT_NAME} Registration Code"
            body = (
                f"Your registration code is: {code}\n"
                f"This code will expire in {settings.EMAIL_CODE_TTL_SECONDS // 60} minutes."
            )
        dispatch_email(email, subject, body)

        return SendCodeResult(
            challenge_id=challenge_id,
            cooldown=settings.EMAIL_CODE_COOLDOWN_SECONDS,
        )

    def verify_email_code(self, request: VerifyCodeRequest) -> dict[str, str]:
        key = f"{REDIS_KEY_VERIFY_PREFIX}{request.challenge_id}"
        raw = self.redis_client.get(key)
        if not raw:
            raise ValidationException(
                code=ErrorCode.VERIFICATION_CODE_INVALID,
                field="code",
            )

        data = json.loads(raw)
        if data["email"] != request.email or data["code_hash"] != self._hash_code(
            request.code,
            request.email,
        ):
            raise ValidationException(
                code=ErrorCode.VERIFICATION_CODE_WRONG,
                field="code",
            )

        verified_token = security.create_email_verification_token(
            subject=f"verify:{request.email}",
            expires_delta=timedelta(minutes=15),
        )
        self.redis_client.delete(key)
        return {"verified_token": verified_token}

    def verify_password_reset_code(self, request: VerifyCodeRequest) -> dict[str, str]:
        key = f"{REDIS_KEY_VERIFY_PREFIX}{request.challenge_id}"
        raw = self.redis_client.get(key)
        if not raw:
            raise ValidationException(
                code=ErrorCode.VERIFICATION_CODE_INVALID,
                field="code",
            )

        data = json.loads(raw)
        if data.get("purpose") != "password_reset":
            raise ValidationException(
                code=ErrorCode.VERIFICATION_TYPE_MISMATCH,
                field="code",
            )

        if data["email"] != request.email or data["code_hash"] != self._hash_code(
            request.code,
            request.email,
        ):
            raise ValidationException(
                code=ErrorCode.VERIFICATION_CODE_WRONG,
                field="code",
            )

        reset_token = security.create_password_reset_token(
            subject=f"reset:{request.email}",
            expires_delta=timedelta(minutes=15),
        )
        self.redis_client.delete(key)
        return {"reset_token": reset_token}

    async def reset_password(self, db: AsyncSession, request: ResetPasswordRequest) -> None:
        try:
            payload = security.decode_token(request.reset_token)
            if payload.get("typ") != "password_reset":
                raise ValidationException(
                    code=ErrorCode.RESET_TOKEN_INVALID,
                    field="reset_token",
                )
            token_email = str(payload.get("sub", "")).replace("reset:", "")
            if not token_email or token_email != request.email:
                raise ValidationException(
                    code=ErrorCode.RESET_TOKEN_INVALID,
                    field="reset_token",
                )
        except ValueError:
            raise ValidationException(
                code=ErrorCode.TOKEN_INVALID_EXPIRED,
                field="reset_token",
            )

        result = await db.exec(select(User).where(User.email == request.email))
        user = result.one_or_none()
        if not user:
            return

        user.password_hash = security.get_password_hash(request.new_password)
        changed_at = utc_now_naive()
        user.password_changed_at = changed_at
        await self.revoke_user_refresh_tokens(
            db,
            require_persisted_id(user.id, entity="user"),
            revoked_at=changed_at,
            commit=False,
        )
        await db.commit()
