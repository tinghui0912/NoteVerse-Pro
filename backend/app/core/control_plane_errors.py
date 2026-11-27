"""Machine-readable failures owned by the Control Plane HTTP contract."""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict

from app.shared.request_id import RequestId


class ControlPlaneErrorCode(StrEnum):
    VALIDATION_ERROR = "validation_error"
    TOKEN_INVALID_EXPIRED = "token_invalid_expired"
    INVALID_CREDENTIALS = "invalid_credentials"
    NO_ACCESS = "no_access"
    UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type"
    RATE_LIMIT_EXCEEDED = "rate_limit_exceeded"
    RATE_LIMIT_UNAVAILABLE = "rate_limit_unavailable"
    REQUEST_ORIGIN_INVALID = "request_origin_invalid"
    RESOURCE_NOT_FOUND = "resource_not_found"
    AUTH_FAILED = "auth_failed"
    UNAUTHORIZED = "unauthorized"
    UNKNOWN_ERROR = "unknown_error"
    INTERNAL_ERROR = "internal_error"


class ControlPlaneErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: ControlPlaneErrorCode
    request_id: RequestId


def control_plane_error_response(code: StrEnum, request_id: str) -> dict[str, object]:
    admitted = (
        code if isinstance(code, ControlPlaneErrorCode) else ControlPlaneErrorCode.INTERNAL_ERROR
    )
    return ControlPlaneErrorResponse(code=admitted, request_id=request_id).model_dump(mode="json")
