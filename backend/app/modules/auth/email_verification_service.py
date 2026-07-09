"""Registration and email verification workflow."""

import hashlib
import secrets
from datetime import timedelta
from urllib.parse import urlencode

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.exceptions import ResourceAlreadyExistsException, ValidationException
from app.db.models.auth import PendingRegistration
from app.db.models.user import User
from app.modules.auth.schemas import RegisterRequest, VerifyEmailRequest
from app.modules.mail.outbox_service import queue_mail
from app.modules.mail.templates.auth import build_email_verification_email
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class EmailVerificationService:
    """Owns pending registrations and email verification tokens."""

    def _hash_token(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _new_token(self) -> str:
        return secrets.token_urlsafe(48)

    def _frontend_url(self, path: str, token: str) -> str:
        base_url = settings.FRONTEND_BASE_URL.rstrip("/")
        return f"{base_url}{path}?{urlencode({'token': token})}"

    async def register(
        self,
        db: AsyncSession,
        request: RegisterRequest,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> None:
        email = str(request.email).strip().lower()
        result = await db.exec(select(User).where(User.email == email))
        if result.one_or_none():
            raise ResourceAlreadyExistsException(
                resource_type="user",
                details={"email": email},
            )

        ttl_seconds = settings.EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS
        token = self._new_token()
        now = utc_now_naive()
        password_hash = security.get_password_hash(request.password)
        pending_result = await db.exec(
            select(PendingRegistration).where(PendingRegistration.email == email)
        )
        pending = pending_result.one_or_none()
        if pending:
            pending.display_name = request.display_name
            pending.password_hash = password_hash
            pending.token_hash = self._hash_token(token)
            pending.expires_at = now + timedelta(seconds=ttl_seconds)
            pending.consumed_at = None
            pending.resend_count += 1
            pending.user_agent = user_agent
            pending.ip_address = ip_address
            pending.updated_at = now
        else:
            pending = PendingRegistration(
                email=email,
                display_name=request.display_name,
                password_hash=password_hash,
                token_hash=self._hash_token(token),
                expires_at=now + timedelta(seconds=ttl_seconds),
                user_agent=user_agent,
                ip_address=ip_address,
            )
            db.add(pending)
        await db.flush()

        email_content = build_email_verification_email(
            locale=request.locale,
            project_name=settings.PROJECT_NAME,
            verification_url=self._frontend_url("/auth/verify-email", token),
            ttl_seconds=ttl_seconds,
        )
        await queue_mail(
            db,
            category="verification.email",
            dedupe_key=f"verification.email:{email}:{self._hash_token(token)}",
            recipient=email,
            subject=email_content.subject,
            text_body=email_content.text_body,
            html_body=email_content.html_body,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        await db.commit()

    async def verify_email(self, db: AsyncSession, request: VerifyEmailRequest) -> User:
        now = utc_now_naive()
        result = await db.exec(
            select(PendingRegistration).where(
                PendingRegistration.token_hash == self._hash_token(request.token)
            )
        )
        pending = result.one_or_none()
        if not pending or pending.consumed_at is not None or pending.expires_at <= now:
            raise ValidationException(code=ErrorCode.TOKEN_INVALID_EXPIRED, field="token")

        existing_result = await db.exec(select(User).where(User.email == pending.email))
        if existing_result.one_or_none():
            raise ResourceAlreadyExistsException(
                resource_type="user",
                details={"email": pending.email},
            )

        pending.consumed_at = now
        user = User(
            email=pending.email,
            display_name=pending.display_name,
            password_hash=pending.password_hash,
            is_active=True,
            email_verified_at=now,
        )
        db.add(user)
        await db.delete(pending)
        await db.commit()
        await db.refresh(user)
        return user
