"""Machine-readable failures owned by the Control Plane HTTP contract."""

from pydantic import BaseModel, ConfigDict

from app.shared.request_id import RequestId


class ControlPlaneErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    request_id: RequestId


def control_plane_error_response(code: str, request_id: str) -> dict[str, object]:
    return ControlPlaneErrorResponse(code=code, request_id=request_id).model_dump()
