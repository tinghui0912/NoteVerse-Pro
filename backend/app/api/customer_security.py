"""Customer HTTP security policy, separate from browser protocol identity."""

from fastapi.routing import RouteContext


# These commands establish/refresh sessions or prove identity using credentials
# or a one-time email token. Ambient stale cookies must not require a CSRF token.
CUSTOMER_CSRF_EXEMPT_OPERATION_IDS = frozenset(
    {
        "authLogin",
        "authRefresh",
        "authRegister",
        "authEmailVerify",
        "authEmailChangeConfirm",
        "authPasswordResetRequest",
        "authPasswordReset",
    }
)


def customer_csrf_exempt_operation(operation: RouteContext) -> bool:
    """Classify the explicitly declared identity of an actually matched operation."""
    return getattr(operation, "operation_id", None) in CUSTOMER_CSRF_EXEMPT_OPERATION_IDS
