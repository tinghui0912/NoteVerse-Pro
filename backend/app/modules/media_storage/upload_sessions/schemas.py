"""Public upload capabilities contain no provider credentials or raw locator fields."""

from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from .domain import UploadMode, UploadStatus


class UploadTargetRead(BaseModel):
    url: str
    method: str
    headers: dict[str, str]
    expires_in: int


class UploadSessionRead(BaseModel):
    session_id: str
    mode: UploadMode
    status: UploadStatus
    expected_byte_size: int
    expected_content_type: str
    expires_at: datetime
    part_size: int
    part_count: int
    recommended_concurrency: int
    upload_target: UploadTargetRead | None = None


class UploadPartRead(BaseModel):
    part_number: int
    etag: str
    byte_size: int


class UploadCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_request_id: str = Field(min_length=1, max_length=128, pattern=r"^\S(?:.*\S)?$")
    filename: str = Field(min_length=1, max_length=255)
    byte_size: int = Field(strict=True, gt=0)
    content_type: str = Field(min_length=1, max_length=255)
