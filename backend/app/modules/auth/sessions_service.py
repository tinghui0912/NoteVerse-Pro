"""Authenticated session management."""

import hashlib
import secrets
from datetime import timedelta

from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.exceptions import AuthenticationException, ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models.auth import RefreshToken
from app.db.models.user import User
from app.modules.auth.schemas import SessionSummary
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class SessionService:
    """Owns refresh-token lifecycle and session rotation."""

    def _hash_token(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _new_refresh_token(self) -> str:
        return secrets.token_urlsafe(48)

    def _current_token_hash(self, refresh_token: str | None) -> str | None:
        return self._hash_token(refresh_token) if refresh_token else None

    async def create_token_pair(
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

        if user.password_changed_at and current_token.created_at < user.password_changed_at:
            current_token.revoked_at = now
            await db.commit()
            raise AuthenticationException(
                code=ErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "password_changed"},
            )

        current_token.revoked_at = now
        current_token.last_used_at = now
        access_token, next_refresh_token, next_record = await self.create_token_pair(
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

    async def list_user_sessions(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        current_refresh_token: str | None = None,
        limit: int = 100,
    ) -> list[SessionSummary]:
        now = utc_now_naive()
        current_token_hash = self._current_token_hash(current_refresh_token)
        revoked_at_column = RefreshToken.__table__.c.revoked_at
        result = await db.exec(
            select(RefreshToken)
            .where(
                RefreshToken.user_id == user_id,
                revoked_at_column.is_(None),
                RefreshToken.expires_at > now,
            )
            .order_by(col(RefreshToken.created_at).desc())
            .limit(limit)
        )
        sessions = [
            record
            for record in result.all()
            if record.user_id == user_id
            and record.revoked_at is None
            and record.expires_at > now
        ]
        return [
            SessionSummary(
                id=require_persisted_id(record.id, entity="refresh_token"),
                device_id=record.device_id,
                user_agent=record.user_agent,
                ip_address=record.ip_address,
                created_at=record.created_at,
                last_used_at=record.last_used_at,
                expires_at=record.expires_at,
                is_current=bool(current_token_hash and record.token_hash == current_token_hash),
            )
            for record in sessions
        ]

    async def revoke_user_session(
        self,
        db: AsyncSession,
        user_id: int,
        session_id: int,
        *,
        current_refresh_token: str | None = None,
    ) -> bool:
        now = utc_now_naive()
        result = await db.exec(
            select(RefreshToken).where(
                RefreshToken.id == session_id,
                RefreshToken.user_id == user_id,
            )
        )
        record = next(
            (
                item
                for item in result.all()
                if item.id == session_id and item.user_id == user_id
            ),
            None,
        )
        if (
            not record
            or record.user_id != user_id
            or record.revoked_at is not None
            or record.expires_at <= now
        ):
            raise ResourceNotFoundException(
                resource_type="session",
                resource_id=str(session_id),
            )

        is_current = bool(
            current_refresh_token
            and record.token_hash == self._hash_token(current_refresh_token)
        )
        record.revoked_at = now
        await db.commit()
        return is_current

    async def revoke_other_user_sessions(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        current_refresh_token: str | None,
    ) -> None:
        if not current_refresh_token:
            raise AuthenticationException(
                code=ErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "missing_refresh_token"},
            )

        now = utc_now_naive()
        current_token_hash = self._hash_token(current_refresh_token)
        revoked_at_column = RefreshToken.__table__.c.revoked_at
        result = await db.exec(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id,
                revoked_at_column.is_(None),
                RefreshToken.expires_at > now,
            )
        )
        for record in result.all():
            if (
                record.user_id == user_id
                and record.revoked_at is None
                and record.expires_at > now
                and record.token_hash != current_token_hash
            ):
                record.revoked_at = now
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
