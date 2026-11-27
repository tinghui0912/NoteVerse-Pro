"""Dependency providers for the account module."""

from app.modules.account.profile_service import ProfileService


def get_profile_service() -> ProfileService:
    """Provide the profile service from the account module boundary."""

    return ProfileService()
