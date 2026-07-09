"""Current-user profile management."""

from app.db.models import User
from app.modules.account.schemas import UpdateProfileRequest
from sqlalchemy.ext.asyncio import AsyncSession


class ProfileService:
    """Owns current-user display profile state."""

    def profile_payload(
        self,
        user: User,
    ) -> dict[str, object]:
        return {
            "user": {
                "id": user.id,
                "email": user.email,
                "display_name": user.display_name or user.email.split("@")[0],
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "is_active": user.is_active,
                "avatar_url": user.avatar_url,
            }
        }

    async def update_profile(
        self,
        db: AsyncSession,
        user: User,
        request: UpdateProfileRequest,
    ) -> list[str]:
        updated_fields: list[str] = []

        if request.display_name and request.display_name != user.display_name:
            user.display_name = request.display_name
            updated_fields.append("display_name")

        if updated_fields:
            await db.commit()

        return updated_fields
