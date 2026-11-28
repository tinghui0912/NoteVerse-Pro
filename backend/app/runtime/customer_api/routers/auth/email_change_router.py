"""Routes for authenticated email change requests and confirmation links."""

from app.runtime.customer_api.rate_limits import limit_recovery

from app.platform.db.dependencies import get_db

from fastapi import Response, APIRouter, Depends, Request


from sqlalchemy.orm import Session

from app.runtime.customer_api import deps
from app.platform.security.client_ip import client_ip
from app.db.models import User
from app.runtime.customer_api.auth_services import get_email_change_service
from app.modules.auth.email_change_service import EmailChangeService
from app.modules.auth.schemas import (
    ConfirmEmailChangeRequest,
    EmailChangeConfirmedRead,
    RequestEmailChangeRequest,
)


me_router = APIRouter()
auth_router = APIRouter()


@me_router.post(
    "/email/change",
    dependencies=[Depends(limit_recovery)],
    operation_id="accountEmailChangeRequest",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def request_my_email_change(
    request_context: Request,
    request: RequestEmailChangeRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(get_db),
    email_change_service: EmailChangeService = Depends(get_email_change_service),
) -> Response:
    email_change_service.request_email_change(
        db,
        current_user,
        request,
        user_agent=request_context.headers.get("user-agent"),
        ip_address=client_ip(
            request_context.scope,
            trusted_proxy_cidrs=request_context.app.state.settings.TRUSTED_PROXY_CIDRS,
            trusted_proxy_hops=request_context.app.state.settings.TRUSTED_PROXY_HOPS,
        ),
    )
    return Response(status_code=204)


@auth_router.post(
    "/email/change/confirm",
    dependencies=[Depends(limit_recovery)],
    operation_id="authEmailChangeConfirm",
    response_model=EmailChangeConfirmedRead,
)
def confirm_email_change(
    request: ConfirmEmailChangeRequest,
    db: Session = Depends(get_db),
    email_change_service: EmailChangeService = Depends(get_email_change_service),
) -> EmailChangeConfirmedRead:
    user = email_change_service.confirm_email_change(db, request)
    return EmailChangeConfirmedRead(email=user.email)
