"""Authorization policies for isolated control-plane operator actions."""

from __future__ import annotations


import enum
from collections.abc import Callable

from fastapi import Depends

from app.core.exceptions import UnauthorizedException
from app.db.models import OperatorRole
from app.runtime.control_plane.deps import OperatorPrincipal, get_current_operator
from app.core.control_plane_errors import ControlPlaneErrorCode


class PlatformOperationAction(str, enum.Enum):
    READ = "operations.read"
    RETRY = "operations.retry"


_ACTION_ROLES: dict[PlatformOperationAction, frozenset[OperatorRole]] = {
    PlatformOperationAction.READ: frozenset({OperatorRole.PLATFORM_OPERATOR}),
    PlatformOperationAction.RETRY: frozenset({OperatorRole.PLATFORM_OPERATOR}),
}


def require_platform_operation(
    action: PlatformOperationAction,
) -> Callable[..., OperatorPrincipal]:
    """Return a dependency enforcing one platform operator action."""

    def dependency(
        current_operator: OperatorPrincipal = Depends(get_current_operator),
    ) -> OperatorPrincipal:
        if current_operator.role not in _ACTION_ROLES[action]:
            raise UnauthorizedException(code=ControlPlaneErrorCode.NO_ACCESS)
        return current_operator

    return dependency
