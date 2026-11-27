"""Authentication routes owned exclusively by the control-plane runtime."""

from fastapi import APIRouter, Cookie, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.client_address import client_address
from app.core.control_plane_settings import require_control_plane_settings
from app.modules.platform_operators.dependencies import OperatorPrincipal, get_current_operator
from app.modules.platform_operators.schemas import OperatorLoginCommand, OperatorRead
from app.modules.platform_operators.service import (
    OperatorAuthenticationService,
    operator_authentication_service,
)
from app.modules.platform_operators.session_cookies import (
    clear_control_plane_session_cookies,
    set_control_plane_session_cookies,
)
from app.core.generated.control_plane_browser_protocol import OPERATOR_AUTH_COOKIE_NAME


router = APIRouter()


def get_operator_authentication_service() -> OperatorAuthenticationService:
    return operator_authentication_service


def _operator_read(principal: OperatorPrincipal) -> OperatorRead:
    return OperatorRead(
        operator_id=principal.operator.operator_uuid,
        display_name=principal.operator.display_name,
        role=principal.operator.role,
    )


@router.post("/login", status_code=204, response_class=Response, operation_id="operatorLogin")
def login_operator(
    command: OperatorLoginCommand,
    request: Request,
    response: Response,
    db: Session = Depends(get_db, scope="function"),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
) -> Response:
    security = require_control_plane_settings()
    _, _, token = service.authenticate_local_password(
        db,
        username=command.username,
        password=command.password,
        user_agent=request.headers.get("user-agent"),
        ip_address=client_address(request),
        security_settings=security,
    )
    set_control_plane_session_cookies(response, session_token=token, security=security)
    response.status_code = 204
    return response


@router.post("/logout", status_code=204, response_class=Response, operation_id="operatorLogout")
def logout_operator(
    response: Response,
    db: Session = Depends(get_db, scope="function"),
    session_cookie: str | None = Cookie(
        default=None,
        alias=OPERATOR_AUTH_COOKIE_NAME,
    ),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
) -> Response:
    security = require_control_plane_settings()
    service.revoke_session(db, token=session_cookie)
    clear_control_plane_session_cookies(response, security=security)
    response.status_code = 204
    return response


@router.get("/me", response_model=OperatorRead, operation_id="operatorCurrentGet")
def current_operator(
    principal: OperatorPrincipal = Depends(get_current_operator),
) -> OperatorRead:
    return _operator_read(principal)
