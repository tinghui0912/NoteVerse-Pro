"""Authenticated email-change workflow."""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from urllib.parse import urlencode

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.exceptions import ResourceAlreadyExistsException, ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models.auth import EmailChangeRequest
from app.db.models.user import User
from app.modules.auth.schemas import ConfirmEmailChangeRequest, RequestEmailChangeRequest
from app.modules.mail.outbox_service import queue_mail
from app.modules.mail.templates.auth import (
    build_email_change_confirmation_email,
    build_email_changed_email,
)
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class EmailChangeService:
    """Owns request-confirm email change tokens for authenticated users."""

    def _hash_token(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _new_token(self) -> str:
        return secrets.token_urlsafe(48)

    def _frontend_url(self, path: str, token: str) -> str:
        base_url = settings.FRONTEND_BASE_URL.rstrip("/")
        return f"{base_url}{path}?{urlencode({'token': token})}"

    async def request_email_change(
        self,
        db: AsyncSession,
        user: User,
        request: RequestEmailChangeRequest,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> None:
        new_email = str(request.new_email).strip().lower()
        if new_email == user.email.lower():
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="new_email",
                details={"reason": "email_unchanged"},
            )
        if not security.verify_password(request.current_password, user.password_hash):
            raise ValidationException(code=ErrorCode.CURRENT_PASSWORD_WRONG, field="current_password")

        existing_result = await db.exec(select(User).where(User.email == new_email))
        if next((item for item in existing_result.all() if item.email == new_email), None):
            raise ResourceAlreadyExistsException(
                resource_type="user",
                details={"email": new_email},
            )

        now = utc_now_naive()
        user_id = require_persisted_id(user.id, entity="user")
        consumed_at_column = EmailChangeRequest.__table__.c.consumed_at
        pending_result = await db.exec(
            select(EmailChangeRequest).where(
                EmailChangeRequest.user_id == user_id,
                consumed_at_column.is_(None),
            )
        )
        for pending in pending_result.all():
            if pending.user_id == user_id and pending.consumed_at is None:
                pending.consumed_at = now

        ttl_seconds = settings.EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS
        token = self._new_token()
        email_change = EmailChangeRequest(
            user_id=user_id,
            new_email=new_email,
            token_hash=self._hash_token(token),
            locale=request.locale,
            user_agent=user_agent,
            ip_address=ip_address,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        db.add(email_change)
        await db.flush()

        email_content = build_email_change_confirmation_email(
            locale=request.locale,
            project_name=settings.PROJECT_NAME,
            confirmation_url=self._frontend_url("/auth/confirm-email-change", token),
            ttl_seconds=ttl_seconds,
        )
        await queue_mail(
            db,
            category="email.change.requested",
            dedupe_key=f"email.change:{user_id}:{self._hash_token(token)}",
            recipient=new_email,
            subject=email_content.subject,
            text_body=email_content.text_body,
            html_body=email_content.html_body,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        await db.commit()

    async def confirm_email_change(
        self,
        db: AsyncSession,
        request: ConfirmEmailChangeRequest,
    ) -> User:
        now = utc_now_naive()
        result = await db.exec(
            select(EmailChangeRequest).where(
                EmailChangeRequest.token_hash == self._hash_token(request.token)
            )
        )
        record = next(
            (
                item
                for item in result.all()
                if item.token_hash == self._hash_token(request.token)
            ),
            None,
        )
        if not record or record.consumed_at is not None or record.expires_at <= now:
            raise ValidationException(code=ErrorCode.TOKEN_INVALID_EXPIRED, field="token")

        user_result = await db.exec(select(User).where(User.id == record.user_id))
        user = next((item for item in user_result.all() if item.id == record.user_id), None)
        if not user or not user.is_active:
            raise ValidationException(code=ErrorCode.TOKEN_INVALID_EXPIRED, field="token")

        existing_result = await db.exec(select(User).where(User.email == record.new_email))
        existing = next(
            (item for item in existing_result.all() if item.email == record.new_email),
            None,
        )
        if existing and existing.id != user.id:
            raise ResourceAlreadyExistsException(
                resource_type="user",
                details={"email": record.new_email},
            )

        old_email = user.email
        user.email = record.new_email
        user.email_verified_at = now
        record.consumed_at = now

        email_content = build_email_changed_email(
            locale=record.locale,
            project_name=settings.PROJECT_NAME,
            new_email=record.new_email,
        )
        await queue_mail(
            db,
            category="email.change.completed",
            dedupe_key=f"email.change.completed:{require_persisted_id(user.id, entity='user')}:{now.isoformat()}",
            recipient=old_email,
            subject=email_content.subject,
            text_body=email_content.text_body,
            html_body=email_content.html_body,
        )
        await db.commit()
        await db.refresh(user)
        return user
