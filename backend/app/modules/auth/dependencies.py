"""Dependency providers for the auth module."""

from app.modules.auth.service import AuthService
from app.modules.auth.email_change_service import EmailChangeService
from app.modules.auth.email_verification_service import EmailVerificationService
from app.modules.auth.password_reset_service import PasswordResetService
from app.modules.auth.password_service import PasswordService
from app.modules.auth.security_service import SecurityService
from app.modules.auth.sessions_service import SessionService


def get_auth_service() -> AuthService:
    """Provide the auth service from the auth module boundary."""

    return AuthService()


def get_email_verification_service() -> EmailVerificationService:
    """Provide the email verification service from the auth module boundary."""

    return EmailVerificationService()


def get_email_change_service() -> EmailChangeService:
    """Provide the email change service from the auth module boundary."""

    return EmailChangeService()


def get_password_service() -> PasswordService:
    """Provide the password service from the auth module boundary."""

    return PasswordService(session_service=SessionService())


def get_password_reset_service() -> PasswordResetService:
    """Provide the password reset service from the auth module boundary."""

    return PasswordResetService(session_service=SessionService())


def get_session_service() -> SessionService:
    """Provide the session service from the auth module boundary."""

    return SessionService()


def get_security_service() -> SecurityService:
    """Provide the security overview service from the auth module boundary."""

    return SecurityService()
