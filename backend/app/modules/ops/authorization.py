"""Authorization policies for isolated control-plane operator actions."""

from __future__ import annotations

import enum
from collections.abc import Awaitable, Callable

from fastapi import Depends

from app.core.exceptions import UnauthorizedException
from app.db.models import OperatorRole
from app.modules.platform_operators.dependencies import OperatorPrincipal, get_current_operator
from app.shared.constants import ErrorCode


class PlatformOperationAction(str, enum.Enum):
    READ = "operations.read"
    RETRY = "operations.retry"


_ACTION_ROLES: dict[PlatformOperationAction, frozenset[OperatorRole]] = {
    PlatformOperationAction.READ: frozenset({OperatorRole.PLATFORM_OPERATOR}),
    PlatformOperationAction.RETRY: frozenset({OperatorRole.PLATFORM_OPERATOR}),
}


def require_platform_operation(
    action: PlatformOperationAction,
) -> Callable[..., Awaitable[OperatorPrincipal]]:
    """Return a dependency enforcing one platform operator action."""

    async def dependency(
        current_operator: OperatorPrincipal = Depends(get_current_operator),
    ) -> OperatorPrincipal:
        if current_operator.role not in _ACTION_ROLES[action]:
            raise UnauthorizedException(code=ErrorCode.NO_ACCESS)
        return current_operator

    return dependency
