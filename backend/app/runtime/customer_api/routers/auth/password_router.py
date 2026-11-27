"""Routes for authenticated password management."""

from app.platform.db.dependencies import get_db

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.runtime.customer_api import deps
from app.core.client_address import client_address
from app.db.models import User
from app.runtime.customer_api.auth_services import get_password_service
from app.modules.auth.password_service import PasswordService
from app.modules.auth.schemas import ChangePasswordRequest
from app.modules.auth.session_cookies import set_session_cookies


router = APIRouter()


@router.put(
    "/password",
    operation_id="accountPasswordChange",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def change_my_password(
    request_context: Request,
    response: Response,
    request: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
    password_service: PasswordService = Depends(get_password_service),
) -> Response:
    token = password_service.change_current_user_password(
        db,
        current_user,
        request,
        user_agent=request_context.headers.get("user-agent"),
        ip_address=client_address(
            request_context,
            trusted_proxy_cidrs=request_context.app.state.settings.TRUSTED_PROXY_CIDRS,
        ),
    )
    set_session_cookies(response, token, config=request_context.app.state.settings)
    response.status_code = 204
    return response
