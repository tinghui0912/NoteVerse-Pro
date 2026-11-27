"""Code-owned Control Plane roles and stable permission identities."""

from enum import StrEnum
from app.modules.platform_operators import domain


class OperatorPermission(StrEnum):
    OPERATIONS_READ = "operations.read"
    OPERATIONS_RETRY = "operations.retry"
    USERS_READ = "users.read"
    USERS_SUSPEND = "users.suspend"
    AUDIT_READ = "audit.read"
    OPERATORS_MANAGE = "operators.manage"


ROLE_PERMISSIONS = {
    domain.OperatorRole.SUPPORT_READONLY: frozenset(
        {
            OperatorPermission.OPERATIONS_READ,
            OperatorPermission.USERS_READ,
            OperatorPermission.AUDIT_READ,
        }
    ),
    domain.OperatorRole.PLATFORM_OPERATOR: frozenset(
        {
            OperatorPermission.OPERATIONS_READ,
            OperatorPermission.OPERATIONS_RETRY,
            OperatorPermission.USERS_READ,
            OperatorPermission.AUDIT_READ,
        }
    ),
    domain.OperatorRole.SUPER_ADMIN: frozenset(OperatorPermission),
}
