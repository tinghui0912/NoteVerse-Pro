"""Authorization policies for platform operator actions.

The current product has one platform operator role. Actions are still modeled
explicitly so future roles can be introduced without coupling route handlers to
the user-role enum or retrofitting a generic RBAC schema prematurely.
"""

from __future__ import annotations

import enum
from collections.abc import Callable

from fastapi import Depends

from app.api.deps import get_current_user
from app.core.exceptions import UnauthorizedException
from app.db.models import User, UserRole
from app.shared.constants import ErrorCode


class PlatformOperationAction(str, enum.Enum):
    READ = "operations.read"
    RETRY = "operations.retry"


_ACTION_ROLES: dict[PlatformOperationAction, frozenset[UserRole]] = {
    PlatformOperationAction.READ: frozenset({UserRole.admin}),
    PlatformOperationAction.RETRY: frozenset({UserRole.admin}),
}


def require_platform_operation(
    action: PlatformOperationAction,
) -> Callable[..., User]:
    """Return a dependency enforcing one platform operator action."""

    async def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in _ACTION_ROLES[action]:
            raise UnauthorizedException(code=ErrorCode.NO_ACCESS)
        return current_user

    return dependency
