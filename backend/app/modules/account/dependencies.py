"""Dependency providers for the account module."""

from app.modules.account.avatar_service import AvatarService
from app.modules.account.profile_service import ProfileService


def get_avatar_service() -> AvatarService:
    """Provide the avatar service from the account module boundary."""

    return AvatarService()


def get_profile_service() -> ProfileService:
    """Provide the profile service from the account module boundary."""

    return ProfileService()
