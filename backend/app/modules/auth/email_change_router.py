"""Routes for authenticated email change requests and confirmation links."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.models import User
from app.modules.auth.dependencies import get_email_change_service
from app.modules.auth.email_change_service import EmailChangeService
from app.modules.auth.schemas import ConfirmEmailChangeRequest, RequestEmailChangeRequest
from app.shared.constants import SuccessCode
from app.shared.responses import SuccessResponsePayload, success_response

me_router = APIRouter()
auth_router = APIRouter()


@me_router.post("/email/change")
async def request_my_email_change(
    request_context: Request,
    request: RequestEmailChangeRequest,
    current_user: User = Depends(deps.get_current_user),
    db: AsyncSession = Depends(deps.get_db),
    email_change_service: EmailChangeService = Depends(get_email_change_service),
) -> SuccessResponsePayload:
    await email_change_service.request_email_change(
        db,
        current_user,
        request,
        user_agent=request_context.headers.get("user-agent"),
        ip_address=request_context.client.host if request_context.client else None,
    )
    return success_response(message=SuccessCode.VERIFICATION_SUCCESS)


@auth_router.post("/email/change/confirm")
async def confirm_email_change(
    request: ConfirmEmailChangeRequest,
    db: AsyncSession = Depends(deps.get_db),
    email_change_service: EmailChangeService = Depends(get_email_change_service),
) -> SuccessResponsePayload:
    user = await email_change_service.confirm_email_change(db, request)
    return success_response(
        data={"email": user.email},
        message=SuccessCode.EMAIL_VERIFIED,
    )
