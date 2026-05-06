"""Dependency providers for the auth module."""

from app.modules.auth.service import AuthService


def get_auth_service() -> AuthService:
    """Provide the auth service from the auth module boundary."""

    return AuthService()
