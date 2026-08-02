"""Authentication routes owned exclusively by the control-plane runtime."""

from fastapi import APIRouter, Cookie, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.client_address import client_address
from app.core.control_plane_settings import require_control_plane_settings
from app.modules.platform_operators.dependencies import OperatorPrincipal, get_current_operator
from app.modules.platform_operators.schemas import OperatorLoginCommand, OperatorRead
from app.modules.platform_operators.service import OperatorAuthenticationService, operator_authentication_service
from app.modules.platform_operators.session_cookies import (
    clear_control_plane_session_cookies,
    set_control_plane_session_cookies,
)
from app.shared.constants import SuccessCode
from app.shared.responses import SuccessResponsePayload, success_response


router = APIRouter()


def get_operator_authentication_service() -> OperatorAuthenticationService:
    return operator_authentication_service


def _operator_read(principal: OperatorPrincipal) -> OperatorRead:
    return OperatorRead(
        operator_id=principal.operator.operator_uuid,
        display_name=principal.operator.display_name,
        role=principal.operator.role,
    )


@router.post("/login", response_model=SuccessResponsePayload)
async def login_operator(
    command: OperatorLoginCommand,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
) -> SuccessResponsePayload:
    security = require_control_plane_settings()
    _, _, token = await service.authenticate_local_password(
        db,
        username=command.username,
        password=command.password,
        user_agent=request.headers.get("user-agent"),
        ip_address=client_address(request),
        security_settings=security,
    )
    set_control_plane_session_cookies(response, session_token=token, security=security)
    return success_response(message=SuccessCode.LOGIN_SUCCESS)


@router.post("/logout", response_model=SuccessResponsePayload)
async def logout_operator(
    response: Response,
    db: AsyncSession = Depends(get_db),
    session_cookie: str | None = Cookie(
        default=None,
        alias=require_control_plane_settings().auth_cookie_name,
    ),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
) -> SuccessResponsePayload:
    security = require_control_plane_settings()
    await service.revoke_session(db, token=session_cookie)
    clear_control_plane_session_cookies(response, security=security)
    return success_response(message=SuccessCode.LOGOUT_SUCCESS)


@router.get("/me", response_model=OperatorRead)
async def current_operator(principal: OperatorPrincipal = Depends(get_current_operator)) -> OperatorRead:
    return _operator_read(principal)
