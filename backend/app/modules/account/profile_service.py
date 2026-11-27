"""Current-user profile management."""

from app.modules.account.avatar_presentation import avatar_url_for_user

from app.db.models import User
from app.modules.account.schemas import ProfileRead, ProfileUserRead, UpdateProfileRequest
from sqlalchemy.orm import Session


class ProfileService:
    """Owns current-user display profile state."""

    def profile_payload(
        self,
        user: User,
    ) -> ProfileRead:
        return ProfileRead(
            user=ProfileUserRead(
                id=user.id,
                email=user.email,
                display_name=user.display_name or user.email.split("@")[0],
                created_at=user.created_at,
                is_active=user.is_active,
                avatar_url=avatar_url_for_user(user),
            )
        )

    def update_profile(
        self,
        db: Session,
        user: User,
        request: UpdateProfileRequest,
    ) -> list[str]:
        updated_fields: list[str] = []

        if request.display_name and request.display_name != user.display_name:
            user.display_name = request.display_name
            updated_fields.append("display_name")

        if updated_fields:
            db.commit()

        return updated_fields
