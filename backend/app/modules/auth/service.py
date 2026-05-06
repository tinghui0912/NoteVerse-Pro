"""Authentication service layer for the auth module."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import timedelta

import redis
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core import security
from app.core.config import settings
from app.core.exceptions import (
    AuthenticationException,
    ResourceAlreadyExistsException,
    ValidationException,
)
from app.db.models.user import User
from app.modules.auth.schemas import (
    RegisterRequest,
    ResetPasswordRequest,
    SendCodeResult,
    SendCodeRequest,
    Token,
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

    async def login(self, db: AsyncSession, email: str, password: str) -> Token:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalars().first()

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

        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        return Token(
            access_token=security.create_access_token(
                user.id,
                expires_delta=access_token_expires,
            ),
            token_type="bearer",
        )

    async def register(self, db: AsyncSession, request: RegisterRequest) -> User:
        try:
            payload = security.decode_access_token(request.verified_token)
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

        result = await db.execute(select(User).where(User.email == request.email))
        if result.scalars().first():
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
        else:
            subject = f"{settings.PROJECT_NAME} Verification Code"
            body = (
                f"Your verification code is: {code}\n"
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

        verified_token = security.create_access_token(
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

        reset_token = security.create_access_token(
            subject=f"reset:{request.email}",
            expires_delta=timedelta(minutes=15),
        )
        self.redis_client.delete(key)
        return {"reset_token": reset_token}

    async def reset_password(self, db: AsyncSession, request: ResetPasswordRequest) -> None:
        try:
            payload = security.decode_access_token(request.reset_token)
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

        result = await db.execute(select(User).where(User.email == request.email))
        user = result.scalars().first()
        if not user:
            return

        user.password_hash = security.get_password_hash(request.new_password)
        user.password_changed_at = utc_now_naive()
        await db.commit()
