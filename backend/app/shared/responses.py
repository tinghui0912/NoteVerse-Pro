"""
Shared API response models and helpers.
"""
from typing import Generic, Optional, Sequence, TypeVar

from pydantic import BaseModel, Field
from typing_extensions import TypedDict

T = TypeVar("T")


class PaginationMeta(TypedDict):
    """Pagination metadata returned by paginated API responses."""

    page: int
    page_size: int
    total: int
    total_pages: int


class SuccessResponsePayload(TypedDict, total=False):
    """Default success response payload shape."""

    success: bool
    data: object
    message: str
    code: str


class ErrorResponsePayload(TypedDict, total=False):
    """Default error response payload shape."""

    success: bool
    error: str
    code: str
    details: dict[str, object]


class PaginatedResponsePayload(TypedDict):
    """Default paginated response payload shape."""

    success: bool
    data: list[object]
    pagination: PaginationMeta


class APIResponse(BaseModel, Generic[T]):
    success: bool = Field(..., description="Whether the request succeeded")
    data: Optional[T] = Field(None, description="Response payload")
    message: Optional[str] = Field(None, description="Human-readable message")
    code: Optional[str] = Field(None, description="Business code")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "success": True,
                    "data": {"id": 1, "name": "Example task"},
                    "message": "Operation succeeded",
                }
            ]
        }
    }


class PaginatedResponse(BaseModel, Generic[T]):
    success: bool = True
    data: list[T]
    pagination: PaginationMeta = Field(..., description="Pagination metadata")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "success": True,
                    "data": [{"id": 1}, {"id": 2}],
                    "pagination": {
                        "page": 1,
                        "page_size": 20,
                        "total": 100,
                        "total_pages": 5,
                    },
                }
            ]
        }
    }


class EmptyResponse(APIResponse[None]):
    pass


def success_response(
    data: object = None,
    message: Optional[str] = None,
    code: Optional[str] = None,
) -> SuccessResponsePayload:
    response: SuccessResponsePayload = {"success": True}
    if data is not None:
        response["data"] = data
    if message:
        response["message"] = message
    if code:
        response["code"] = code
    return response


def error_response(
    error: str,
    code: str = "ERROR",
    details: Optional[dict[str, object]] = None,
) -> ErrorResponsePayload:
    response: ErrorResponsePayload = {
        "success": False,
        "error": error,
        "code": code,
    }
    if details:
        response["details"] = details
    return response


def paginated_response(
    data: Sequence[object],
    page: int,
    page_size: int,
    total: int,
) -> PaginatedResponsePayload:
    return {
        "success": True,
        "data": list(data),
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
        },
    }
