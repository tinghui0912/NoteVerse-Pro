"""Account security overview service."""

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.model_utils import require_persisted_id
from app.db.models.auth import RefreshToken
from app.db.models.user import User
from app.modules.auth.schemas import SecurityOverview
from app.utils.timezone import utc_now_naive


class SecurityService:
    """Read-only account security signals for the current user."""

    async def overview(self, db: AsyncSession, user: User) -> SecurityOverview:
        user_id = require_persisted_id(user.id, entity="user")
        now = utc_now_naive()
        revoked_at_column = RefreshToken.__table__.c.revoked_at
        result = await db.exec(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id,
                revoked_at_column.is_(None),
                RefreshToken.expires_at > now,
            )
        )
        active_sessions_count = sum(
            1
            for record in result.all()
            if record.user_id == user_id
            and record.revoked_at is None
            and record.expires_at > now
        )

        return SecurityOverview(
            email=user.email,
            email_verified_at=user.email_verified_at,
            password_changed_at=user.password_changed_at,
            active_sessions_count=active_sessions_count,
            mfa_enabled=False,
            mfa_available=False,
            last_login=user.last_login,
        )
