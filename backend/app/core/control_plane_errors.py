"""Machine-readable failures owned by the Control Plane HTTP contract."""

from pydantic import BaseModel, ConfigDict, Field


class ControlPlaneErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    request_id: str = Field(min_length=1)


def control_plane_error_response(code: str, request_id: str) -> dict[str, object]:
    return ControlPlaneErrorResponse(code=code, request_id=request_id).model_dump()
