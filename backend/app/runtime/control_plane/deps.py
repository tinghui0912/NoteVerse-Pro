"""Operator-session authentication and static permission dependencies."""

from dataclasses import dataclass
from fastapi import Depends, Request
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.modules.platform_operators.domain import OperatorStatus
from app.shared.time import utc_now
from app.platform.db.dependencies import get_db
from app.core.exceptions import AuthenticationException, UnauthorizedException
from app.core.control_plane_errors import ControlPlaneErrorCode
from app.db.models import Operator, OperatorSession
from app.modules.platform_operators.domain import OperatorRole
from app.modules.platform_operators.permissions import OperatorPermission, ROLE_PERMISSIONS
from app.modules.platform_operators.service import OperatorAuthenticationService


@dataclass(frozen=True, slots=True)
class OperatorPrincipal:
    operator: Operator
    session: OperatorSession

    @property
    def role(self) -> OperatorRole:
        return self.operator.role


def get_operator_authentication_service(request: Request) -> OperatorAuthenticationService:
    return request.app.state.operator_authentication


def get_current_operator(
    request: Request,
    db: Session = Depends(get_db, scope="function"),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
) -> OperatorPrincipal:
    token = request.cookies.get(service.config.auth_cookie_name)
    if not token:
        raise AuthenticationException(code=ControlPlaneErrorCode.TOKEN_INVALID_EXPIRED)
    operator, session = service.resolve_session(db, token=token)
    db.commit()
    return OperatorPrincipal(operator=operator, session=session)


def require_permission(permission: OperatorPermission):
    def authorized(
        principal: OperatorPrincipal = Depends(get_current_operator),
    ) -> OperatorPrincipal:
        if permission not in ROLE_PERMISSIONS.get(principal.role, frozenset()):
            raise UnauthorizedException(code=ControlPlaneErrorCode.NO_ACCESS)
        return principal

    setattr(authorized, "required_permission", permission)
    return authorized


def lock_operator_command(
    db: Session, principal: OperatorPrincipal, permission: OperatorPermission
) -> None:
    """Admit an audited command before business row locks or audit FK locks."""
    operator = db.scalar(
        select(Operator)
        .where(Operator.id == principal.operator.id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    session = db.scalar(
        select(OperatorSession)
        .where(OperatorSession.id == principal.session.id)
        .execution_options(populate_existing=True)
    )
    now = utc_now()
    if (
        operator is None
        or operator.status != OperatorStatus.ACTIVE
        or operator.totp_enabled_at is None
        or session is None
        or session.operator_id != operator.id
        or session.revoked_at is not None
        or session.idle_expires_at <= now
        or session.absolute_expires_at <= now
    ):
        raise AuthenticationException(code=ControlPlaneErrorCode.TOKEN_INVALID_EXPIRED)
    if permission not in ROLE_PERMISSIONS[operator.role]:
        raise UnauthorizedException(code=ControlPlaneErrorCode.NO_ACCESS)
