from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class PerformanceTakeUploadAuthorizationRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    score_id: str = Field(min_length=1, max_length=64)
    client_request_id: str = Field(min_length=1, max_length=128)
    media_kind: str = Field(default="AUDIO", pattern="^(AUDIO|VIDEO)$")
    media_byte_size: int = Field(gt=0)
    media_mime_type: str = Field(min_length=1, max_length=64)
    duration_ms: int = Field(ge=0)
    scope_type: str = Field(default="FULL", pattern="^(FULL|RANGE)$")
    scope_start_beat: float = Field(ge=0.0)
    scope_terminal_beat: float = Field(gt=0.0)
    revision_id: Optional[str] = Field(default=None, max_length=64)
    artifact_id: Optional[str] = None
    tempo_selection: Optional[dict[str, Any]] = None
    resolved_tempo_plan: Optional[dict[str, Any]] = None
    sync_metadata: Optional[dict[str, Any]] = None


class PerformanceTakeUploadAuthorizationRead(BaseModel):
    take_id: str
    status: str = "AUTHORIZED"
    upload_url: Optional[str] = None
    upload_method: Optional[str] = None
    upload_headers: dict[str, str] = Field(default_factory=dict)
    object_key: Optional[str] = None
    reservation_id: Optional[str] = None
    expires_in: int = 0
    take: Optional["PerformanceTakeRead"] = None


class PerformanceTakeCreateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    take_id: str = Field(min_length=1, max_length=36)
    client_request_id: str = Field(min_length=1, max_length=128)
    reservation_id: str = Field(min_length=1, max_length=128)
    score_id: str = Field(min_length=1, max_length=64)
    media_kind: str = Field(default="AUDIO", pattern="^(AUDIO|VIDEO)$")
    media_byte_size: int = Field(gt=0)
    media_mime_type: str = Field(min_length=1, max_length=64)
    duration_ms: int = Field(ge=0)
    scope_type: str = Field(default="FULL", pattern="^(FULL|RANGE)$")
    scope_start_beat: float = Field(ge=0.0)
    scope_terminal_beat: float = Field(gt=0.0)
    revision_id: Optional[str] = Field(default=None, max_length=64)
    artifact_id: Optional[str] = None
    tempo_selection: Optional[dict[str, Any]] = None
    resolved_tempo_plan: Optional[dict[str, Any]] = None
    sync_metadata: Optional[dict[str, Any]] = None


class PerformanceTakeRead(BaseModel):
    take_id: str
    score_id: Optional[str] = None
    score_title: Optional[str] = None
    revision_id: Optional[str] = None
    artifact_id: Optional[str] = None
    media_kind: str
    media_mime_type: str
    media_byte_size: int
    duration_ms: int
    scope_type: str = "FULL"
    scope_start_beat: float
    scope_terminal_beat: float
    deletion_status: str = "ACTIVE"
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


class PerformanceTakeDeleteResponse(BaseModel):
    status: str
    take_id: str


class PerformanceTakeListResponse(BaseModel):
    items: list[PerformanceTakeRead]
    total: int
    limit: int = 50
    offset: int = 0
    has_more: bool = False
