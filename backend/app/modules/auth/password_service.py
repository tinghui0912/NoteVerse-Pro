"""Password management for authenticated users."""

import secrets
from datetime import timedelta

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.exceptions import ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models.auth import RefreshToken
from app.db.models.user import User
from app.modules.auth.schemas import ChangePasswordRequest
from app.modules.mail.outbox_service import queue_mail
from app.modules.mail.templates.auth import build_password_changed_email
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class PasswordService:
    """Owns current-user credential changes."""

    async def change_current_user_password(
        self,
        db: AsyncSession,
        user: User,
        request: ChangePasswordRequest,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
        device_id: str | None = None,
    ) -> tuple[str, str]:
        if not security.verify_password(request.current_password, user.password_hash):
            raise ValidationException(
                code=ErrorCode.CURRENT_PASSWORD_WRONG,
                field="current_password",
            )

        changed_at = utc_now_naive()
        user.password_hash = security.get_password_hash(request.new_password)
        user.password_changed_at = changed_at

        user_id = require_persisted_id(user.id, entity="user")
        await self._revoke_user_refresh_tokens(db, user_id, revoked_at=changed_at)
        access_token, refresh_token = await self._create_token_pair(
            db,
            user_id,
            user_agent=user_agent,
            ip_address=ip_address,
            device_id=device_id,
        )

        email_content = build_password_changed_email(
            locale=request.locale,
            project_name=settings.PROJECT_NAME,
        )
        await queue_mail(
            db,
            category="password.changed",
            dedupe_key=f"password.changed:{user_id}:{changed_at.isoformat()}",
            recipient=user.email,
            subject=email_content.subject,
            text_body=email_content.text_body,
            html_body=email_content.html_body,
        )
        await db.commit()
        return access_token, refresh_token

    async def _revoke_user_refresh_tokens(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        revoked_at,
    ) -> None:
        revoked_at_column = RefreshToken.__table__.c.revoked_at
        result = await db.exec(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id,
                revoked_at_column.is_(None),
            )
        )
        for record in result.all():
            record.revoked_at = revoked_at

    async def _create_token_pair(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
        device_id: str | None = None,
    ) -> tuple[str, str]:
        access_token = security.create_access_token(
            user_id,
            expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        refresh_token = secrets.token_urlsafe(48)
        db.add(
            RefreshToken(
                user_id=user_id,
                token_hash=self._hash_token(refresh_token),
                device_id=device_id,
                user_agent=user_agent,
                ip_address=ip_address,
                expires_at=utc_now_naive() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            )
        )
        await db.flush()
        return access_token, refresh_token

    @staticmethod
    def _hash_token(token: str) -> str:
        import hashlib

        return hashlib.sha256(token.encode("utf-8")).hexdigest()
