"""Authenticated permanent account-deletion admission, in the caller transaction."""

from sqlalchemy.orm import Session
from app.core import security
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now
from app.db.models import AccountDeletionOperation
from app.modules.auth.sessions_service import SessionService
from .deletion_repository import AccountDeletionRepository
from app.modules.auth.credential_lifecycle import invalidate_user_credentials
from app.modules.auth.mail_lifecycle import cancel_user_authentication_mail
from app.modules.collaboration.mail_lifecycle import cancel_closed_account_invite_mail


class AccountDeletionService:
    def __init__(self, repository: AccountDeletionRepository | None = None) -> None:
        self.repository = repository or AccountDeletionRepository()

    def request_deletion(self, db: Session, user_id: int, *, current_password: str) -> str:
        user = self.repository.lock_user(db, user_id)
        if user is None:
            raise ResourceNotFoundException("user", str(user_id))
        if not security.verify_password(current_password, user.password_hash):
            raise ValidationException(
                CustomerErrorCode.CURRENT_PASSWORD_WRONG, field="current_password"
            )
        existing = self.repository.for_user(db, user_id)
        if existing is not None:
            return existing.operation_uuid
        now = utc_now()
        user.deleted_at = now
        user.is_active = False
        invalidate_user_credentials(db, user_id, now=now)
        cancel_user_authentication_mail(db, user_id)
        cancel_closed_account_invite_mail(db, user_id)
        SessionService().revoke_user_refresh_tokens(db, user_id, revoked_at=now, commit=False)
        operation = AccountDeletionOperation(
            user_id=user_id,
            user_id_snapshot=user_id,
            created_at=now,
            updated_at=now,
            next_attempt_at=now,
        )
        db.add(operation)
        db.flush()
        return operation.operation_uuid
