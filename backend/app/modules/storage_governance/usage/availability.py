"""Fail-closed availability of the committed accounting projection."""

from app.core.exceptions import AppException
from app.shared.error_codes import CustomerErrorCode


def usage_projection_unavailable() -> AppException:
    return AppException(
        code=CustomerErrorCode.QUOTA_CHECK_UNAVAILABLE,
        status_code=503,
        details={"authority": "storage_usage_account"},
    )
