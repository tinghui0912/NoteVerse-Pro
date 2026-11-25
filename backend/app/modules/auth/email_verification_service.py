"""Registration and email verification workflow."""

import hashlib
import secrets
from datetime import timedelta
from urllib.parse import urlencode

from sqlmodel import select
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.exceptions import ResourceAlreadyExistsException, ValidationException
from app.db.models.auth import PendingRegistration
from app.db.models.user import User
from app.db.model_utils import require_persisted_id
from app.composition.storage_resources import provision_storage_resources
from app.modules.auth.schemas import RegisterRequest, VerifyEmailRequest
from app.modules.mail.outbox_service import queue_mail, cancel_source_mail
from app.db.models.mail_outbox import MailSourceKind
from app.modules.mail.templates.auth import build_email_verification_email
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now


class EmailVerificationService:
    """Owns pending registrations and email verification tokens."""

    def _hash_token(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _new_token(self) -> str:
        return secrets.token_urlsafe(48)

    def _frontend_url(self, path: str, token: str) -> str:
        base_url = settings.FRONTEND_BASE_URL.rstrip("/")
        return f"{base_url}{path}?{urlencode({'token': token})}"

    def register(
        self,
        db: Session,
        request: RegisterRequest,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> None:
        email = str(request.email).strip().lower()
        result = db.execute(select(User).where(User.email == email))
        if result.scalars().one_or_none():
            raise ResourceAlreadyExistsException(
                resource_type="user",
                details={"email": email},
            )

        ttl_seconds = settings.EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS
        token = self._new_token()
        now = utc_now()
        password_hash = security.get_password_hash(request.password)
        pending_result = db.execute(
            select(PendingRegistration)
            .where(PendingRegistration.email == email)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        pending = pending_result.scalars().one_or_none()
        if pending:
            cancel_source_mail(
                db,
                MailSourceKind.REGISTRATION,
                select(PendingRegistration.id).where(PendingRegistration.id == pending.id),
            )
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
        db.flush()

        email_content = build_email_verification_email(
            locale=request.locale,
            project_name=settings.PROJECT_NAME,
            verification_url=self._frontend_url("/auth/verify-email", token),
            ttl_seconds=ttl_seconds,
        )
        queue_mail(
            db,
            category="verification.email",
            source_kind=MailSourceKind.REGISTRATION,
            source_id=require_persisted_id(pending.id, entity="pending registration"),
            dedupe_key=f"verification.email:{pending.id}:{self._hash_token(token)}",
            recipient=email,
            subject=email_content.subject,
            text_body=email_content.text_body,
            html_body=email_content.html_body,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        db.commit()

    def verify_email(self, db: Session, request: VerifyEmailRequest) -> User:
        now = utc_now()
        result = db.execute(
            select(PendingRegistration)
            .where(PendingRegistration.token_hash == self._hash_token(request.token))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        pending = result.scalars().one_or_none()
        if not pending or pending.consumed_at is not None or pending.expires_at <= now:
            raise ValidationException(code=CustomerErrorCode.TOKEN_INVALID_EXPIRED, field="token")

        existing_result = db.execute(select(User).where(User.email == pending.email))
        if existing_result.scalars().one_or_none():
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
        db.flush()
        provision_storage_resources(db, require_persisted_id(user.id, entity="user"))
        cancel_source_mail(
            db,
            MailSourceKind.REGISTRATION,
            select(PendingRegistration.id).where(PendingRegistration.id == pending.id),
        )
        db.delete(pending)
        db.commit()
        db.refresh(user)
        return user
