"""Canonical router for the auth module."""

from fastapi import APIRouter, Cookie, Depends, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.exceptions import AuthenticationException
from app.modules.auth.dependencies import (
    get_auth_service,
    get_email_verification_service,
    get_password_reset_service,
    get_session_service,
)
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
from app.core.config import settings
from app.shared.constants import ErrorCode, SuccessCode
from app.shared.responses import SuccessResponsePayload, success_response

router = APIRouter()


@router.post("/login")
async def login_access_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessResponsePayload:
    access_token, refresh_token = await auth_service.login(
        db,
        form_data.username,
        form_data.password,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    set_session_cookies(response, access_token, refresh_token)
    return success_response(message=SuccessCode.LOGIN_SUCCESS)


@router.post("/logout")
async def logout(
    response: Response,
    db: AsyncSession = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    session_service: SessionService = Depends(get_session_service),
) -> SuccessResponsePayload:
    await session_service.revoke_refresh_token(db, refresh_cookie)
    clear_session_cookies(response)
    return success_response(message=SuccessCode.LOGOUT_SUCCESS)


@router.post("/refresh")
async def refresh_access_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    session_service: SessionService = Depends(get_session_service),
) -> SuccessResponsePayload:
    if not refresh_cookie:
        clear_session_cookies(response)

        raise AuthenticationException(
            code=ErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "missing_refresh_token"},
        )

    access_token, refresh_token = await session_service.refresh_session(
        db,
        refresh_cookie,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    set_session_cookies(response, access_token, refresh_token)
    return success_response(message=SuccessCode.LOGIN_SUCCESS)


@router.post("/register")
async def register_user(
    request_context: Request,
    *,
    db: AsyncSession = Depends(deps.get_db),
    request: RegisterRequest,
    email_verification_service: EmailVerificationService = Depends(
        get_email_verification_service
    ),
) -> SuccessResponsePayload:
    await email_verification_service.register(
        db,
        request,
        user_agent=request_context.headers.get("user-agent"),
        ip_address=request_context.client.host if request_context.client else None,
    )
    return success_response(message=SuccessCode.VERIFICATION_SUCCESS)


@router.post("/email/verify", response_model=UserSchema)
async def verify_email(
    request: VerifyEmailRequest,
    db: AsyncSession = Depends(deps.get_db),
    email_verification_service: EmailVerificationService = Depends(
        get_email_verification_service
    ),
) -> UserSchema:
    return await email_verification_service.verify_email(db, request)


@router.post("/password/forgot")
async def forgot_password(
    request_context: Request,
    request: ForgotPasswordRequest,
    db: AsyncSession = Depends(deps.get_db),
    password_reset_service: PasswordResetService = Depends(get_password_reset_service),
) -> SuccessResponsePayload:
    await password_reset_service.request_password_reset(
        db,
        request,
        user_agent=request_context.headers.get("user-agent"),
        ip_address=request_context.client.host if request_context.client else None,
    )
    return success_response(message=SuccessCode.VERIFICATION_SUCCESS)


@router.post("/password/reset")
async def reset_password(
    request: ResetPasswordRequest,
    db: AsyncSession = Depends(deps.get_db),
    password_reset_service: PasswordResetService = Depends(get_password_reset_service),
):
    await password_reset_service.reset_password(db, request)
    return success_response(message=SuccessCode.PASSWORD_RESET_SUCCESS)


__all__ = ["router"]
