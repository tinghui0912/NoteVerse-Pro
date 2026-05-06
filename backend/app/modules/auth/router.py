"""
Canonical router for the auth module.
"""
from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.dependencies import get_auth_service
from app.modules.auth.schemas import (
    RegisterRequest,
    ResetPasswordRequest,
    SendCodeRequest,
    Token,
    User as UserSchema,
    VerifyCodeRequest,
)
from app.modules.auth.service import AuthService
from app.shared.constants import SuccessCode
from app.shared.responses import SuccessResponsePayload, success_response

router = APIRouter()


@router.post("/login", response_model=Token)
async def login_access_token(
    db: AsyncSession = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service: AuthService = Depends(get_auth_service),
) -> Token:
    return await auth_service.login(db, form_data.username, form_data.password)


@router.post("/register", response_model=UserSchema)
async def register_user(
    *,
    db: AsyncSession = Depends(deps.get_db),
    request: RegisterRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> UserSchema:
    return await auth_service.register(db, request)


@router.post("/email/send-code")
def send_email_code(
    request: SendCodeRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessResponsePayload:
    result = auth_service.send_email_code(request)
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
