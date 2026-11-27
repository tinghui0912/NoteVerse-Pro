"""Password management for authenticated users."""

from app.modules.auth.session_states import SessionRevocationReason as Reason


from app.platform.config.service_identity import ServiceIdentitySettings

from sqlalchemy.orm import Session

from app.platform.security import passwords as security
from app.core.exceptions import ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models.user import User
from app.modules.auth.schemas import ChangePasswordRequest
from app.modules.auth.sessions_service import SessionService
from app.modules.mail.outbox_service import queue_mail
from app.db.models.mail_outbox import MailSourceKind
from app.modules.auth.credential_lifecycle import lock_credential_user
from app.modules.mail.templates.auth import build_password_changed_email
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now


class PasswordService:
    """Owns current-user credential changes."""

    def __init__(self, session_service: SessionService, *, config: ServiceIdentitySettings) -> None:
        self.config = config
        self.session_service = session_service

    def change_current_user_password(
        self,
        db: Session,
        user: User,
        request: ChangePasswordRequest,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> str:
        user = lock_credential_user(db, require_persisted_id(user.id, entity="user"))
        if not security.verify_password(request.current_password, user.password_hash):
            raise ValidationException(
                code=CustomerErrorCode.CURRENT_PASSWORD_WRONG,
                field="current_password",
            )

        changed_at = utc_now()
        user.password_hash = security.hash_password(request.new_password)
        user.password_changed_at = changed_at

        user_id = require_persisted_id(user.id, entity="user")
        self.session_service.revoke_user_sessions(
            db,
            user_id,
            reason=Reason.PASSWORD_CHANGED,
            revoked_at=changed_at,
            commit=False,
        )
        token, _ = self.session_service.create_session(
            db,
            user_id,
            user_agent=user_agent,
            ip_address=ip_address,
        )

        email_content = build_password_changed_email(
            locale=request.locale,
            project_name=self.config.PROJECT_NAME,
        )
        queue_mail(
            db,
            category="password.changed",
            source_kind=MailSourceKind.ACCOUNT,
            source_id=user_id,
            dedupe_key=f"password.changed:{user_id}:{changed_at.isoformat()}",
            recipient=user.email,
            subject=email_content.subject,
            text_body=email_content.text_body,
            html_body=email_content.html_body,
        )
        db.commit()
        return token
