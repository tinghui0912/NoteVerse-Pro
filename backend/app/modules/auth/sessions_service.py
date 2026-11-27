"""Authenticated session management."""

import hashlib
import secrets
from datetime import timedelta

from sqlmodel import col, select
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.exceptions import AuthenticationException, ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models.auth import RefreshToken
from app.db.models.user import User
from app.modules.auth.schemas import SessionSummary
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now


class SessionService:
    """Owns refresh-token lifecycle and session rotation."""

    def _hash_token(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _new_refresh_token(self) -> str:
        return secrets.token_urlsafe(48)

    def _current_token_hash(self, refresh_token: str | None) -> str | None:
        return self._hash_token(refresh_token) if refresh_token else None

    def create_token_pair(
        self,
        db: Session,
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
            expires_at=utc_now() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
        db.add(record)
        db.flush()
        return access_token, refresh_token, record

    def refresh_session(
        self,
        db: Session,
        refresh_token: str,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
        device_id: str | None = None,
    ) -> tuple[str, str]:
        token_hash = self._hash_token(refresh_token)
        result = db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        current_token = result.scalars().one_or_none()
        now = utc_now()

        if not current_token:
            raise AuthenticationException(
                code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "refresh_not_found"},
            )
        if current_token.revoked_at is not None:
            raise AuthenticationException(
                code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "refresh_revoked"},
            )
        if current_token.expires_at <= now:
            raise AuthenticationException(
                code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "refresh_expired"},
            )

        result = db.execute(select(User).where(User.id == current_token.user_id))
        user = result.scalars().one_or_none()
        if not user or not user.is_active or user.deleted_at is not None:
            current_token.revoked_at = now
            db.commit()
            raise AuthenticationException(
                code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "user_inactive_or_missing"},
            )

        if user.password_changed_at and current_token.created_at < user.password_changed_at:
            current_token.revoked_at = now
            db.commit()
            raise AuthenticationException(
                code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "password_changed"},
            )

        current_token.revoked_at = now
        current_token.last_used_at = now
        access_token, next_refresh_token, next_record = self.create_token_pair(
            db,
            require_persisted_id(user.id, entity="user"),
            user_agent=user_agent or current_token.user_agent,
            ip_address=ip_address or current_token.ip_address,
            device_id=device_id or current_token.device_id,
        )
        current_token.replaced_by_token_id = require_persisted_id(
            next_record.id, entity="refresh_token"
        )
        db.commit()
        return access_token, next_refresh_token

    def revoke_refresh_token(self, db: Session, refresh_token: str | None) -> None:
        if not refresh_token:
            return
        result = db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == self._hash_token(refresh_token))
        )
        record = result.scalars().one_or_none()
        if record and record.revoked_at is None:
            record.revoked_at = utc_now()
            db.commit()

    def list_user_sessions(
        self,
        db: Session,
        user_id: int,
        *,
        current_refresh_token: str | None = None,
        limit: int = 100,
    ) -> list[SessionSummary]:
        now = utc_now()
        current_token_hash = self._current_token_hash(current_refresh_token)
        revoked_at_column = RefreshToken.__table__.c.revoked_at
        result = db.execute(
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
            for record in result.scalars().all()
            if record.user_id == user_id and record.revoked_at is None and record.expires_at > now
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

    def revoke_user_session(
        self,
        db: Session,
        user_id: int,
        session_id: int,
        *,
        current_refresh_token: str | None = None,
    ) -> bool:
        now = utc_now()
        result = db.execute(
            select(RefreshToken).where(
                RefreshToken.id == session_id,
                RefreshToken.user_id == user_id,
            )
        )
        record = next(
            (
                item
                for item in result.scalars().all()
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
            current_refresh_token and record.token_hash == self._hash_token(current_refresh_token)
        )
        record.revoked_at = now
        db.commit()
        return is_current

    def revoke_other_user_sessions(
        self,
        db: Session,
        user_id: int,
        *,
        current_refresh_token: str | None,
    ) -> None:
        if not current_refresh_token:
            raise AuthenticationException(
                code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
                details={"reason": "missing_refresh_token"},
            )

        now = utc_now()
        current_token_hash = self._hash_token(current_refresh_token)
        revoked_at_column = RefreshToken.__table__.c.revoked_at
        result = db.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id,
                revoked_at_column.is_(None),
                RefreshToken.expires_at > now,
            )
        )
        for record in result.scalars().all():
            if (
                record.user_id == user_id
                and record.revoked_at is None
                and record.expires_at > now
                and record.token_hash != current_token_hash
            ):
                record.revoked_at = now
        db.commit()

    def revoke_user_refresh_tokens(
        self,
        db: Session,
        user_id: int,
        *,
        revoked_at=None,
        commit: bool = True,
    ) -> None:
        now = revoked_at or utc_now()
        revoked_at_column = RefreshToken.__table__.c.revoked_at
        result = db.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id,
                revoked_at_column.is_(None),
            )
        )
        for record in result.scalars().all():
            record.revoked_at = now
        if commit:
            db.commit()
