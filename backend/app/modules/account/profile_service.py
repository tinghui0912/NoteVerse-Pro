"""Current-user profile management."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User
from app.modules.account.avatar_service import AvatarService
from app.modules.account.schemas import UpdateProfileRequest


class ProfileService:
    """Owns current-user display profile state."""

    async def profile_payload(
        self,
        db: AsyncSession,
        user: User,
        avatar_service: AvatarService,
    ) -> dict[str, object]:
        avatar_url = user.avatar_url
        if avatar_url:
            avatar_filename = avatar_url.split("/")[-1].split("?")[0]
            if not avatar_service.avatar_exists(avatar_filename):
                user.avatar_url = None
                await db.commit()
                avatar_url = None

        return {
            "user": {
                "id": user.id,
                "email": user.email,
                "display_name": user.display_name or user.email.split("@")[0],
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "is_active": user.is_active,
                "avatar_url": avatar_url,
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
