from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class PerformanceTakeUploadAuthorizationRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    score_id: int
    client_request_id: str = Field(min_length=1, max_length=128)
    media_byte_size: int = Field(gt=0)
    media_mime_type: str = Field(min_length=1, max_length=64)
    duration_ms: int = Field(ge=0)
    scope_start_beat: float = Field(ge=0.0)
    scope_terminal_beat: float = Field(gt=0.0)
    revision_id: Optional[int] = None
    artifact_id: Optional[str] = None
    tempo_selection: Optional[dict[str, Any]] = None
    resolved_tempo_plan: Optional[dict[str, Any]] = None
    sync_metadata: Optional[dict[str, Any]] = None


class PerformanceTakeUploadAuthorizationRead(BaseModel):
    take_id: str
    upload_url: str
    upload_method: str
    upload_headers: dict[str, str]
    object_key: str
    reservation_id: str
    expires_in: int


class PerformanceTakeCreateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    take_id: str = Field(min_length=1, max_length=36)
    client_request_id: str = Field(min_length=1, max_length=128)
    reservation_id: str = Field(min_length=1, max_length=128)
    score_id: int
    media_byte_size: int = Field(gt=0)
    media_mime_type: str = Field(min_length=1, max_length=64)
    duration_ms: int = Field(ge=0)
    scope_start_beat: float = Field(ge=0.0)
    scope_terminal_beat: float = Field(gt=0.0)
    revision_id: Optional[int] = None
    artifact_id: Optional[str] = None
    tempo_selection: Optional[dict[str, Any]] = None
    resolved_tempo_plan: Optional[dict[str, Any]] = None
    sync_metadata: Optional[dict[str, Any]] = None


class PerformanceTakeRead(BaseModel):
    take_id: str
    score_id: Optional[int] = None
    score_title: Optional[str] = None
    revision_id: Optional[int] = None
    artifact_id: Optional[str] = None
    media_kind: str
    media_mime_type: str
    media_byte_size: int
    duration_ms: int
    scope_start_beat: float
    scope_terminal_beat: float
    tempo_selection: Optional[dict[str, Any]] = None
    resolved_tempo_plan: Optional[dict[str, Any]] = None
    sync_metadata: Optional[dict[str, Any]] = None
    created_at: datetime


class PerformanceTakePlaybackRead(BaseModel):
    take_id: str
    playback_url: str
    download_url: str
    media_kind: str
    media_mime_type: str
    media_byte_size: int
    duration_ms: int
    expires_in: int


class PerformanceTakeListResponse(BaseModel):
    items: list[PerformanceTakeRead]
    total: int
    limit: int = 50
    offset: int = 0
    has_more: bool = False
