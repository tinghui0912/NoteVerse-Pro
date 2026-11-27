"""Request principals derive exclusively from authoritative Consumer sessions."""

from fastapi import Depends, Request
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from app.platform.db.dependencies import get_db
from app.platform.security.cookies import session_cookie_name
from app.core.exceptions import AuthenticationException, ExternalServiceException
from app.shared.error_codes import CustomerErrorCode
from app.db.models import User
from app.runtime.customer_api.settings import CustomerApiSettings
from app.runtime.customer_api.auth_services import get_session_service


def session_token(request: Request) -> str | None:
    return request.cookies.get(session_cookie_name(request.app.state.settings.AUTH_COOKIE_SECURE))


def get_current_user(
    request: Request, session: Session = Depends(get_db, scope="function")
) -> User:
    token = session_token(request)
    if not token:
        raise AuthenticationException(code=CustomerErrorCode.TOKEN_INVALID_EXPIRED)
    try:
        user, identity = get_session_service(request).authenticate(session, token)
    except (ConnectionRefusedError, SQLAlchemyError) as error:
        raise ExternalServiceException(
            service="database",
            details={"operation": "get_current_user", "type": type(error).__name__},
        ) from error
    request.state.auth_session_id = identity
    return user


def get_optional_current_user(
    request: Request, session: Session = Depends(get_db, scope="function")
) -> User | None:
    if not session_token(request):
        return None
    try:
        return get_current_user(request, session)
    except AuthenticationException:
        return None


def get_settings(request: Request) -> CustomerApiSettings:
    return request.app.state.settings
