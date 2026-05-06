from app.modules.profile.service import AvatarService


def get_avatar_service() -> AvatarService:
    """Provide the avatar service from the profile module boundary."""
    return AvatarService()
