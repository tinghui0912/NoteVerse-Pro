"""Account security overview service."""

from sqlalchemy.orm import Session

from app.db.models.user import User
from app.modules.auth.schemas import SecurityOverview


class SecurityService:
    """Read-only account security signals for the current user."""

    def overview(self, _db: Session, user: User) -> SecurityOverview:
        return SecurityOverview(
            email=user.email,
            email_verified_at=user.email_verified_at,
            password_changed_at=user.password_changed_at,
            mfa_enabled=False,
            mfa_available=False,
        )
