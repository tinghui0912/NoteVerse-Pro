"""Local operator authentication and opaque-session lifecycle."""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.control_plane_settings import ControlPlaneSettings
from app.core.exceptions import AuthenticationException
from app.db.model_utils import require_persisted_id
from app.db.models import (
    Operator,
    OperatorIdentity,
    OperatorIdentityProvider,
    OperatorPasswordCredential,
    OperatorRole,
    OperatorSession,
    OperatorStatus,
)
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


LOCAL_PASSWORD_ISSUER = "noteverse-control-plane-local"


class OperatorAuthenticationService:
    """Authenticate operator-domain identities without using customer records."""

    @staticmethod
    def normalize_username(username: str) -> str:
        return username.strip().lower()

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    async def create_local_operator(
        self,
        db: AsyncSession,
        *,
        username: str,
        password: str,
        display_name: str,
        role: OperatorRole = OperatorRole.PLATFORM_OPERATOR,
    ) -> Operator:
        subject = self.normalize_username(username)
        existing = await db.execute(
            select(OperatorIdentity.id).where(
                OperatorIdentity.provider == OperatorIdentityProvider.LOCAL_PASSWORD,
                OperatorIdentity.issuer == LOCAL_PASSWORD_ISSUER,
                OperatorIdentity.subject == subject,
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise ValueError("operator username already exists")

        operator = Operator(display_name=display_name.strip(), role=role)
        db.add(operator)
        await db.flush()
        identity = OperatorIdentity(
            operator_id=require_persisted_id(operator.id, entity="operator"),
            provider=OperatorIdentityProvider.LOCAL_PASSWORD,
            issuer=LOCAL_PASSWORD_ISSUER,
            subject=subject,
        )
        db.add(identity)
        await db.flush()
        db.add(
            OperatorPasswordCredential(
                identity_id=require_persisted_id(identity.id, entity="operator identity"),
                password_hash=security.get_password_hash(password),
            )
        )
        await db.commit()
        await db.refresh(operator)
        return operator

    async def authenticate_local_password(
        self,
        db: AsyncSession,
        *,
        username: str,
        password: str,
        user_agent: str | None,
        ip_address: str | None,
        security_settings: ControlPlaneSettings,
    ) -> tuple[Operator, OperatorIdentity, str]:
        subject = self.normalize_username(username)
        identity = (
            await db.execute(
                select(OperatorIdentity).where(
                    OperatorIdentity.provider == OperatorIdentityProvider.LOCAL_PASSWORD,
                    OperatorIdentity.issuer == LOCAL_PASSWORD_ISSUER,
                    OperatorIdentity.subject == subject,
                )
            )
        ).scalar_one_or_none()
        if identity is None:
            raise AuthenticationException(code=ErrorCode.INVALID_CREDENTIALS)

        credential = (
            await db.execute(
                select(OperatorPasswordCredential).where(
                    OperatorPasswordCredential.identity_id == identity.id
                )
            )
        ).scalar_one_or_none()
        operator = await db.get(Operator, identity.operator_id)
        if (
            credential is None
            or operator is None
            or operator.status != OperatorStatus.ACTIVE
            or not security.verify_password(password, credential.password_hash)
        ):
            raise AuthenticationException(code=ErrorCode.INVALID_CREDENTIALS)

        now = utc_now_naive()
        token = secrets.token_urlsafe(48)
        db.add(
            OperatorSession(
                identity_id=require_persisted_id(identity.id, entity="operator identity"),
                operator_id=require_persisted_id(operator.id, entity="operator"),
                token_hash=self._hash_token(token),
                user_agent=user_agent,
                ip_address=ip_address,
                authenticated_at=now,
                expires_at=now + timedelta(minutes=security_settings.session_expire_minutes),
            )
        )
        identity.last_authenticated_at = now
        await db.commit()
        return operator, identity, token

    async def resolve_session(self, db: AsyncSession, *, token: str) -> tuple[Operator, OperatorIdentity, OperatorSession]:
        now = utc_now_naive()
        session = (
            await db.execute(
                select(OperatorSession).where(OperatorSession.token_hash == self._hash_token(token))
            )
        ).scalar_one_or_none()
        if session is None or session.revoked_at is not None or session.expires_at <= now:
            raise AuthenticationException(code=ErrorCode.TOKEN_INVALID_EXPIRED)

        operator = await db.get(Operator, session.operator_id)
        identity = await db.get(OperatorIdentity, session.identity_id)
        if operator is None or identity is None or operator.status != OperatorStatus.ACTIVE:
            raise AuthenticationException(code=ErrorCode.TOKEN_INVALID_EXPIRED)
        session.last_used_at = now
        await db.commit()
        return operator, identity, session

    async def revoke_session(self, db: AsyncSession, *, token: str | None) -> None:
        if not token:
            return
        session = (
            await db.execute(
                select(OperatorSession).where(OperatorSession.token_hash == self._hash_token(token))
            )
        ).scalar_one_or_none()
        if session is None or session.revoked_at is not None:
            return
        session.revoked_at = utc_now_naive()
        await db.commit()


operator_authentication_service = OperatorAuthenticationService()
