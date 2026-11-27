"""Mandatory password challenge and MFA authentication endpoints."""

from collections.abc import Callable
from typing import TypeVar
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session
from app.platform.db.dependencies import get_db
from app.core.client_address import client_address
from app.core.exceptions import AuthenticationException
from app.runtime.control_plane.deps import (
    OperatorPrincipal,
    get_current_operator,
    get_operator_authentication_service,
)
from app.modules.platform_operators.schemas import (
    OperatorLoginCommand,
    OperatorRead,
    MfaChallengeRead,
    TotpEnrollmentRead,
    TotpCodeCommand,
    RecoveryCodeCommand,
    MfaEnrollmentRead,
    MfaVerifiedRead,
    operator_read,
)
from app.modules.platform_operators.service import OperatorAuthenticationService, AuditContext
from app.modules.platform_operators.session_cookies import (
    clear_control_plane_session_cookies,
    set_control_plane_session_cookies,
    set_challenge_cookie,
)

router = APIRouter()
T = TypeVar("T")


def audit_context(request: Request) -> AuditContext:
    return AuditContext(
        ip_address=client_address(
            request, trusted_proxy_cidrs=request.app.state.settings.TRUSTED_PROXY_CIDRS
        ),
        user_agent=request.headers.get("user-agent", "")[:512] or None,
        request_id=getattr(request.state, "request_id", None),
    )


def authenticate(db: Session, action: Callable[[], T]) -> T:
    try:
        result = action()
    except AuthenticationException:
        db.commit()
        raise
    db.commit()
    return result


@router.post("/login", response_model=MfaChallengeRead, operation_id="operatorLogin")
def login_operator(
    command: OperatorLoginCommand,
    request: Request,
    response: Response,
    db: Session = Depends(get_db, scope="function"),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
):
    raw, challenge = authenticate(
        db,
        lambda: service.start_login(
            db, email=str(command.email), password=command.password, context=audit_context(request)
        ),
    )
    set_challenge_cookie(response, raw, security=service.config)
    response.headers["Cache-Control"] = "no-store"
    return MfaChallengeRead(purpose=challenge.purpose, expires_at=challenge.expires_at)


@router.post(
    "/mfa/enroll/start",
    response_model=TotpEnrollmentRead,
    operation_id="operatorMfaEnrollmentStart",
)
def start_enrollment(
    request: Request,
    response: Response,
    db: Session = Depends(get_db, scope="function"),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
):
    secret, uri = authenticate(
        db,
        lambda: service.start_enrollment(
            db, request.cookies.get(service.config.challenge_cookie_name), audit_context(request)
        ),
    )
    response.headers["Cache-Control"] = "no-store"
    return TotpEnrollmentRead(secret=secret, otpauth_uri=uri)


@router.post(
    "/mfa/enroll/confirm",
    response_model=MfaEnrollmentRead,
    operation_id="operatorMfaEnrollmentConfirm",
)
def confirm_enrollment(
    command: TotpCodeCommand,
    request: Request,
    response: Response,
    db: Session = Depends(get_db, scope="function"),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
):
    operator, raw, codes = authenticate(
        db,
        lambda: service.confirm_enrollment(
            db,
            request.cookies.get(service.config.challenge_cookie_name),
            command.code,
            audit_context(request),
        ),
    )
    set_control_plane_session_cookies(response, session_token=raw, security=service.config)
    response.headers["Cache-Control"] = "no-store"
    return MfaEnrollmentRead(operator=operator_read(operator), recovery_codes=list(codes))


@router.post("/mfa/verify", response_model=MfaVerifiedRead, operation_id="operatorMfaVerify")
def verify_mfa(
    command: TotpCodeCommand | RecoveryCodeCommand,
    request: Request,
    response: Response,
    db: Session = Depends(get_db, scope="function"),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
):
    operator, raw, remaining = authenticate(
        db,
        lambda: service.verify_mfa(
            db,
            request.cookies.get(service.config.challenge_cookie_name),
            code=command.code if isinstance(command, TotpCodeCommand) else None,
            recovery_code=command.recovery_code
            if isinstance(command, RecoveryCodeCommand)
            else None,
            context=audit_context(request),
        ),
    )
    set_control_plane_session_cookies(response, session_token=raw, security=service.config)
    response.headers["Cache-Control"] = "no-store"
    return MfaVerifiedRead(operator=operator_read(operator), recovery_codes_remaining=remaining)


@router.post("/logout", status_code=204, response_class=Response, operation_id="operatorLogout")
def logout_operator(
    request: Request,
    response: Response,
    _operator: OperatorPrincipal = Depends(get_current_operator),
    db: Session = Depends(get_db, scope="function"),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
) -> Response:
    service.revoke_session(
        db,
        token=request.cookies.get(service.config.auth_cookie_name),
        context=audit_context(request),
    )
    db.commit()
    clear_control_plane_session_cookies(response, security=service.config)
    response.status_code = 204
    return response


@router.get("/me", response_model=OperatorRead, operation_id="operatorCurrentGet")
def current_operator(principal: OperatorPrincipal = Depends(get_current_operator)) -> OperatorRead:
    return operator_read(principal.operator)
