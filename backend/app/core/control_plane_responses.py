"""Control Plane success presentation, independent of Customer representations."""

from typing import Generic, Optional, TypeVar
from pydantic import BaseModel, Field
from typing_extensions import TypedDict
from app.shared.api_model import serialize_utc_values

T = TypeVar("T")


class SuccessResponsePayload(TypedDict, total=False):
    """Default success response payload shape."""

    success: bool
    data: object
    message: str
    code: str


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


def success_response(
    data: object = None,
    message: Optional[str] = None,
    code: Optional[str] = None,
) -> SuccessResponsePayload:
    response: SuccessResponsePayload = {"success": True}
    if data is not None:
        response["data"] = serialize_utc_values(data)
    if message:
        response["message"] = message
    if code:
        response["code"] = code
    return response
