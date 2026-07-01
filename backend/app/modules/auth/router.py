"""Canonical router for the auth module."""

import secrets

from fastapi import APIRouter, Cookie, Depends, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.exceptions import AuthenticationException
from app.modules.auth.dependencies import get_auth_service
from app.modules.auth.schemas import (
    RegisterRequest,
    ResetPasswordRequest,
    SendCodeRequest,
    User as UserSchema,
    VerifyCodeRequest,
)
from app.modules.auth.service import AuthService
from app.core.config import settings
from app.shared.constants import ErrorCode, SuccessCode
from app.shared.responses import SuccessResponsePayload, success_response

router = APIRouter()


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.AUTH_COOKIE_NAME,
        value=token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        path="/",
    )


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        path="/",
    )


def _set_csrf_cookie(response: Response) -> None:
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=secrets.token_urlsafe(32),
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=False,
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        path="/",
    )


def _set_session_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    _set_auth_cookie(response, access_token)
    _set_refresh_cookie(response, refresh_token)
    _set_csrf_cookie(response)


def _clear_session_cookies(response: Response) -> None:
    response.delete_cookie(
        key=settings.AUTH_COOKIE_NAME,
        path="/",
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        httponly=True,
    )
    response.delete_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        path="/",
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        httponly=True,
    )
    response.delete_cookie(
        key=settings.CSRF_COOKIE_NAME,
        path="/",
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        httponly=False,
    )


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
    _set_session_cookies(response, access_token, refresh_token)
    return success_response(message=SuccessCode.LOGIN_SUCCESS)


@router.post("/logout")
async def logout(
    response: Response,
    db: AsyncSession = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessResponsePayload:
    await auth_service.revoke_refresh_token(db, refresh_cookie)
    _clear_session_cookies(response)
    return success_response(message=SuccessCode.LOGOUT_SUCCESS)


@router.post("/refresh")
async def refresh_access_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessResponsePayload:
    if not refresh_cookie:
        _clear_session_cookies(response)

        raise AuthenticationException(
            code=ErrorCode.TOKEN_INVALID_EXPIRED,
            details={"reason": "missing_refresh_token"},
        )

    access_token, refresh_token = await auth_service.refresh_session(
        db,
        refresh_cookie,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    _set_session_cookies(response, access_token, refresh_token)
    return success_response(message=SuccessCode.LOGIN_SUCCESS)


@router.post("/register", response_model=UserSchema)
async def register_user(
    *,
    db: AsyncSession = Depends(deps.get_db),
    request: RegisterRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> UserSchema:
    return await auth_service.register(db, request)


@router.post("/email/send-code")
async def send_email_code(
    request: SendCodeRequest,
    db: AsyncSession = Depends(deps.get_db),
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessResponsePayload:
    result = await auth_service.send_email_code(db, request)
    return success_response(
        data=result.model_dump(),
        message=SuccessCode.VERIFICATION_CODE_SENT,
    )


@router.post("/email/verify-code")
def verify_email_code(
    request: VerifyCodeRequest,
    auth_service: AuthService = Depends(get_auth_service),
):
    result = auth_service.verify_email_code(request)
    return success_response(
        data=result,
        message=SuccessCode.EMAIL_VERIFIED,
    )


@router.post("/password/verify-code")
def verify_password_reset_code(
    request: VerifyCodeRequest,
    auth_service: AuthService = Depends(get_auth_service),
):
    result = auth_service.verify_password_reset_code(request)
    return success_response(
        data=result,
        message=SuccessCode.VERIFICATION_SUCCESS,
    )


@router.post("/password/reset")
async def reset_password(
    request: ResetPasswordRequest,
    db: AsyncSession = Depends(deps.get_db),
    auth_service: AuthService = Depends(get_auth_service),
):
    await auth_service.reset_password(db, request)
    return success_response(message=SuccessCode.PASSWORD_RESET_SUCCESS)


__all__ = ["router"]
