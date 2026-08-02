"""FastAPI dependencies for the control-plane operator principal."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Cookie, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.control_plane_settings import require_control_plane_settings
from app.core.exceptions import AuthenticationException
from app.db.models import Operator, OperatorIdentity, OperatorRole, OperatorSession
from app.modules.platform_operators.service import OperatorAuthenticationService, operator_authentication_service
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


async def get_current_operator(
    db: AsyncSession = Depends(get_db),
    session_cookie: str | None = Cookie(
        default=None,
        alias=require_control_plane_settings().auth_cookie_name,
    ),
    service: OperatorAuthenticationService = Depends(get_operator_authentication_service),
) -> OperatorPrincipal:
    if not session_cookie:
        raise AuthenticationException(code=ErrorCode.TOKEN_INVALID_EXPIRED)
    operator, identity, session = await service.resolve_session(db, token=session_cookie)
    return OperatorPrincipal(operator=operator, identity=identity, session=session)
