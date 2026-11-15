"""FastAPI dependencies for the control-plane operator principal."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Cookie, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.generated.control_plane_browser_protocol import OPERATOR_AUTH_COOKIE_NAME
from app.core.exceptions import AuthenticationException
from app.db.models import Operator, OperatorIdentity, OperatorRole, OperatorSession
from app.modules.platform_operators.service import (
    OperatorAuthenticationService,
    operator_authentication_service,
)
from app.shared.constants import ErrorCode


@dataclass(frozen=True, slots=True)
class OperatorPrincipal:
    operator: Operator
    identity: OperatorIdentity
    session: OperatorSession

    @property
    def role(self) -> OperatorRole:
        return self.operator.role


def get_operator_authentication_service() -> OperatorAuthenticationService:
    return operator_authentication_service


def get_current_operator(
    db: Session = Depends(get_db, scope="function"),
    session_cookie: str | None = Cookie(
        default=None,
        alias=OPERATOR_AUTH_COOKIE_NAME,
    ),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
) -> OperatorPrincipal:
    if not session_cookie:
        raise AuthenticationException(code=ErrorCode.TOKEN_INVALID_EXPIRED)
    operator, identity, session = service.resolve_session(db, token=session_cookie)
    return OperatorPrincipal(operator=operator, identity=identity, session=session)
