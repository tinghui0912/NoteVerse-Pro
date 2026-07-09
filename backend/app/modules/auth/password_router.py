"""Routes for authenticated password management."""

import secrets

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.config import settings
from app.db.models import User
from app.modules.auth.dependencies import get_password_service
from app.modules.auth.password_service import PasswordService
from app.modules.auth.schemas import ChangePasswordRequest
from app.shared.constants import SuccessCode
from app.shared.responses import SuccessResponsePayload, success_response

router = APIRouter()


def _set_session_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        key=settings.AUTH_COOKIE_NAME,
        value=access_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        path="/",
    )
    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        path="/",
    )
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=secrets.token_urlsafe(32),
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=False,
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        path="/",
    )


@router.put("/password")
async def change_my_password(
    request_context: Request,
    response: Response,
    request: ChangePasswordRequest,
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    password_service: PasswordService = Depends(get_password_service),
) -> SuccessResponsePayload:
    access_token, refresh_token = await password_service.change_current_user_password(
        db,
        current_user,
        request,
        user_agent=request_context.headers.get("user-agent"),
        ip_address=request_context.client.host if request_context.client else None,
    )
    _set_session_cookies(response, access_token, refresh_token)
    return success_response(message=SuccessCode.PASSWORD_CHANGED)
