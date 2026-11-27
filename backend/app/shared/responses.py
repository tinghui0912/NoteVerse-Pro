"""Canonical Customer application error representation."""

from enum import StrEnum

from pydantic import BaseModel

from app.shared.error_codes import CustomerErrorCode
from app.shared.request_id import RequestId


class ApiErrorResponse(BaseModel):
    """Machine-readable application failure; presentation remains client-owned."""

    code: CustomerErrorCode
    request_id: RequestId

    model_config = {"extra": "forbid"}


def error_response(code: StrEnum, request_id: str) -> dict[str, object]:
    admitted = code if isinstance(code, CustomerErrorCode) else CustomerErrorCode.INTERNAL_ERROR
    return ApiErrorResponse(code=admitted, request_id=request_id).model_dump(mode="json")
