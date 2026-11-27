"""Canonical router for the auth module."""

from app.platform.db.dependencies import get_db

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.client_address import client_address
from app.runtime.customer_api.auth_services import (
    get_auth_service,
    get_password_reset_service,
    get_session_service,
)
from app.runtime.customer_api.resources import get_email_verification_service
from app.modules.auth.email_verification_service import EmailVerificationService
from app.modules.auth.password_reset_service import PasswordResetService
from app.modules.auth.schemas import (
    ForgotPasswordRequest,
    RegisterRequest,
    LoginRequest,
    ResetPasswordRequest,
    User as UserSchema,
    VerifyEmailRequest,
)
from app.modules.auth.session_cookies import clear_session_cookies, set_session_cookies
from app.modules.auth.sessions_service import SessionService
from app.modules.auth.service import AuthService
from app.modules.account.schemas import ProfileUserRead
from app.runtime.customer_api.deps import session_token


router = APIRouter()


@router.post(
    "/login",
    operation_id="authLogin",
    response_model=ProfileUserRead,
)
def login(
    request: Request,
    response: Response,
    credentials: LoginRequest,
    db: Session = Depends(get_db),
    auth_service: AuthService = Depends(get_auth_service),
) -> ProfileUserRead:
    if (
        request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        != "application/json"
    ):
        from fastapi import HTTPException

        raise HTTPException(status_code=415, detail="application/json required")
    result = auth_service.login(
        db,
        str(credentials.email),
        credentials.password,
        user_agent=request.headers.get("user-agent"),
        ip_address=client_address(
            request, trusted_proxy_cidrs=request.app.state.settings.TRUSTED_PROXY_CIDRS
        ),
    )
    set_session_cookies(response, result.session_token, config=request.app.state.settings)
    return result.principal


@router.post(
    "/logout",
    operation_id="authLogout",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def logout(
    http_request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session_service: SessionService = Depends(get_session_service),
) -> Response:
    session_service.revoke_session(db, session_token(http_request))
    clear_session_cookies(response, config=http_request.app.state.settings)
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
    db: Session = Depends(get_db),
    request: RegisterRequest,
    email_verification_service: EmailVerificationService = Depends(get_email_verification_service),
) -> Response:
    email_verification_service.register(
        db,
        request,
        user_agent=request_context.headers.get("user-agent"),
        ip_address=client_address(
            request_context,
            trusted_proxy_cidrs=request_context.app.state.settings.TRUSTED_PROXY_CIDRS,
        ),
    )
    return Response(status_code=204)


@router.post("/email/verify", operation_id="authEmailVerify", response_model=UserSchema)
def verify_email(
    request: VerifyEmailRequest,
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
    password_reset_service: PasswordResetService = Depends(get_password_reset_service),
) -> Response:
    password_reset_service.request_password_reset(
        db,
        request,
        user_agent=request_context.headers.get("user-agent"),
        ip_address=client_address(
            request_context,
            trusted_proxy_cidrs=request_context.app.state.settings.TRUSTED_PROXY_CIDRS,
        ),
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
    http_request: Request,
    request: ResetPasswordRequest,
    db: Session = Depends(get_db),
    password_reset_service: PasswordResetService = Depends(get_password_reset_service),
) -> Response:
    password_reset_service.reset_password(db, request)
    response = Response(status_code=204)
    clear_session_cookies(response, config=http_request.app.state.settings)
    return response


__all__ = ["router"]
