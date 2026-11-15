"""Canonical Customer application error representation."""

from pydantic import BaseModel

from app.shared.request_id import RequestId


class ApiErrorResponse(BaseModel):
    """Machine-readable application failure; presentation remains client-owned."""

    code: str
    request_id: RequestId

    model_config = {"extra": "forbid"}


def error_response(code: str, request_id: str) -> dict[str, object]:
    return ApiErrorResponse(code=code, request_id=request_id).model_dump(mode="json")
