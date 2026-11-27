"""Dependency providers for the auth module."""

from fastapi import Request
from app.platform.config.application import AccountEmailConfig, CustomerAuthConfig
from app.platform.config.service_identity import ServiceIdentitySettings

from app.modules.auth.service import AuthService
from app.modules.auth.email_change_service import EmailChangeService
from app.modules.auth.password_reset_service import PasswordResetService
from app.modules.auth.password_service import PasswordService
from app.modules.auth.security_service import SecurityService
from app.modules.auth.sessions_service import SessionService


def get_auth_service(request: Request) -> AuthService:
    """Provide the auth service from the auth module boundary."""

    return AuthService(session_service=get_session_service(request))


def get_email_change_service(request: Request) -> EmailChangeService:
    """Provide the email change service from the auth module boundary."""

    return EmailChangeService(
        config=AccountEmailConfig.model_validate(request.app.state.settings.model_dump())
    )


def get_password_service(request: Request) -> PasswordService:
    """Provide the password service from the auth module boundary."""

    return PasswordService(
        session_service=get_session_service(request),
        config=ServiceIdentitySettings.model_validate(request.app.state.settings.model_dump()),
    )


def get_password_reset_service(request: Request) -> PasswordResetService:
    """Provide the password reset service from the auth module boundary."""

    return PasswordResetService(
        session_service=get_session_service(request),
        config=AccountEmailConfig.model_validate(request.app.state.settings.model_dump()),
    )


def get_session_service(request: Request) -> SessionService:
    """Provide the session service from the auth module boundary."""

    return SessionService(
        config=CustomerAuthConfig.model_validate(request.app.state.settings.model_dump())
    )


def get_security_service(request: Request) -> SecurityService:
    """Provide the security overview service from the auth module boundary."""

    return SecurityService()
