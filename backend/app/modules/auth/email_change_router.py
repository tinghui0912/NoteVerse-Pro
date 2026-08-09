"""Routes for authenticated email change requests and confirmation links."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.client_address import client_address
from app.db.models import User
from app.modules.auth.dependencies import get_email_change_service
from app.modules.auth.email_change_service import EmailChangeService
from app.modules.auth.schemas import (
    ConfirmEmailChangeRequest,
    EmailChangeConfirmedRead,
    RequestEmailChangeRequest,
)
from app.shared.constants import SuccessCode
from app.shared.responses import APIResponse, EmptyResponse

me_router = APIRouter()
auth_router = APIRouter()


@me_router.post("/email/change", response_model=EmptyResponse)
async def request_my_email_change(
    request_context: Request,
    request: RequestEmailChangeRequest,
    current_user: User = Depends(deps.get_current_user),
    db: AsyncSession = Depends(deps.get_db),
    email_change_service: EmailChangeService = Depends(get_email_change_service),
) -> EmptyResponse:
    await email_change_service.request_email_change(
        db,
        current_user,
        request,
        user_agent=request_context.headers.get("user-agent"),
        ip_address=client_address(request_context),
    )
    return EmptyResponse(success=True, message=SuccessCode.VERIFICATION_SUCCESS)


@auth_router.post("/email/change/confirm", response_model=APIResponse[EmailChangeConfirmedRead])
async def confirm_email_change(
    request: ConfirmEmailChangeRequest,
    db: AsyncSession = Depends(deps.get_db),
    email_change_service: EmailChangeService = Depends(get_email_change_service),
) -> APIResponse[EmailChangeConfirmedRead]:
    user = await email_change_service.confirm_email_change(db, request)
    return APIResponse(
        success=True,
        data=EmailChangeConfirmedRead(email=user.email),
        message=SuccessCode.EMAIL_VERIFIED,
    )
