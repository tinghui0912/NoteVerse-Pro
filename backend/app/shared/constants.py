"""Shared business codes that are safe to use outside feature modules."""

from app.shared.error_codes import ErrorCode
from app.shared.success_codes import SuccessCode

__all__ = ["ErrorCode", "SuccessCode"]
