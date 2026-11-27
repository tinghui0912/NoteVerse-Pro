"""Canonical router for the auth module."""

from fastapi import APIRouter, Cookie, Depends, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.generated.customer_browser_protocol import REFRESH_COOKIE_NAME
from app.api import deps
from app.core.exceptions import AuthenticationException
from app.core.client_address import client_address
from app.modules.auth.dependencies import (
    get_auth_service,
    get_password_reset_service,
    get_session_service,
)
from app.api.resource_dependencies import get_email_verification_service
from app.modules.auth.email_verification_service import EmailVerificationService
from app.modules.auth.password_reset_service import PasswordResetService
from app.modules.auth.schemas import (
    ForgotPasswordRequest,
    RegisterRequest,
    ResetPasswordRequest,
    User as UserSchema,
    VerifyEmailRequest,
)
from app.modules.auth.session_cookies import clear_session_cookies, set_session_cookies
from app.modules.auth.sessions_service import SessionService
from app.modules.auth.service import AuthService
from app.modules.account.schemas import ProfileUserRead
from app.shared.error_codes import CustomerErrorCode


router = APIRouter()


@router.post(
    "/login",
    operation_id="authLogin",
    response_model=ProfileUserRead,
)
def login_access_token(
    request: Request,
    response: Response,
    db: Session = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service: AuthService = Depends(get_auth_service),
) -> ProfileUserRead:
    result = auth_service.login(
        db,
        form_data.username,
        form_data.password,
        user_agent=request.headers.get("user-agent"),
        ip_address=client_address(request),
    )
    set_session_cookies(response, result.access_token, result.refresh_token)
    return result.principal


@router.post(
    "/logout",
    operation_id="authLogout",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def logout(
    response: Response,
    db: Session = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
    session_service: SessionService = Depends(get_session_service),
) -> Response:
    session_service.revoke_refresh_token(db, refresh_cookie)
    clear_session_cookies(response)
    response.status_code = 204
    return response


@router.post(
    "/refresh",
    operation_id="authRefresh",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def refresh_access_token(
    request: Request,
    response: Response,
    db: Session = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
    session_service: SessionService = Depends(get_session_service),
) -> Response:
    if not refresh_cookie:
        clear_session_cookies(response)

        raise AuthenticationException(
            code=CustomerErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "missing_refresh_token"},
        )

    access_token, refresh_token = session_service.refresh_session(
        db,
        refresh_cookie,
        user_agent=request.headers.get("user-agent"),
        ip_address=client_address(request),
    )
    set_session_cookies(response, access_token, refresh_token)
    response.status_code = 204
    return response


@router.post(
    "/register",
    operation_id="authRegister",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def register_user(
    request_context: Request,
    *,
    db: Session = Depends(deps.get_db),
    request: RegisterRequest,
    email_verification_service: EmailVerificationService = Depends(get_email_verification_service),
) -> Response:
    email_verification_service.register(
        db,
        request,
        user_agent=request_context.headers.get("user-agent"),
        ip_address=client_address(request_context),
    )
    return Response(status_code=204)


@router.post("/email/verify", operation_id="authEmailVerify", response_model=UserSchema)
def verify_email(
    request: VerifyEmailRequest,
    db: Session = Depends(deps.get_db),
    email_verification_service: EmailVerificationService = Depends(get_email_verification_service),
) -> UserSchema:
    return email_verification_service.verify_email(db, request)


@router.post(
    "/password/forgot",
    operation_id="authPasswordResetRequest",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def forgot_password(
    request_context: Request,
    request: ForgotPasswordRequest,
    db: Session = Depends(deps.get_db),
    password_reset_service: PasswordResetService = Depends(get_password_reset_service),
) -> Response:
    password_reset_service.request_password_reset(
        db,
        request,
        user_agent=request_context.headers.get("user-agent"),
        ip_address=client_address(request_context),
    )
    return Response(status_code=204)


@router.post(
    "/password/reset",
    operation_id="authPasswordReset",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def reset_password(
    request: ResetPasswordRequest,
    db: Session = Depends(deps.get_db),
    password_reset_service: PasswordResetService = Depends(get_password_reset_service),
) -> Response:
    password_reset_service.reset_password(db, request)
    response = Response(status_code=204)
    clear_session_cookies(response)
    return response


__all__ = ["router"]
