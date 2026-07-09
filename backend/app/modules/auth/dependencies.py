"""Dependency providers for the auth module."""

from app.modules.auth.service import AuthService
from app.modules.auth.password_service import PasswordService


def get_auth_service() -> AuthService:
    """Provide the auth service from the auth module boundary."""

    return AuthService()


def get_password_service() -> PasswordService:
    """Provide the password service from the auth module boundary."""

    return PasswordService()
