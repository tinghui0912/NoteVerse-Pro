"""Canonical Customer application error representation."""

from pydantic import BaseModel, Field


class ApiErrorResponse(BaseModel):
    """Machine-readable application failure; presentation remains client-owned."""

    code: str
    request_id: str = Field(min_length=1)

    model_config = {"extra": "forbid"}


def error_response(code: str, request_id: str) -> dict[str, object]:
    return ApiErrorResponse(code=code, request_id=request_id).model_dump(mode="json")
