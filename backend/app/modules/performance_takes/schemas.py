from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictPerformanceTakeModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ScoreTempoPlanSelection(StrictPerformanceTakeModel):
    mode: Literal["SCORE"]


class CustomFixedBpmTempoPlanSelection(StrictPerformanceTakeModel):
    mode: Literal["CUSTOM_FIXED_BPM"]
    bpm: float = Field(gt=0)


TempoPlanSelection = ScoreTempoPlanSelection | CustomFixedBpmTempoPlanSelection


class PerformanceTakeTempoPlanSegment(StrictPerformanceTakeModel):
    startBeat: float = Field(ge=0)
    bpm: float = Field(gt=0)
    source: str = Field(pattern="^(MUSICXML|PRODUCT_DEFAULT|CUSTOM)$")


class PerformanceTakeTempoPlan(StrictPerformanceTakeModel):
    selection: TempoPlanSelection = Field(discriminator="mode")
    segments: list[PerformanceTakeTempoPlanSegment] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_segments(self) -> "PerformanceTakeTempoPlan":
        if self.segments[0].startBeat != 0:
            raise ValueError("tempo plan must start at beat zero")
        for previous, current in zip(self.segments, self.segments[1:]):
            if current.startBeat <= previous.startBeat:
                raise ValueError("tempo plan segments must be strictly ordered")
        return self


class RecordingTimebaseSegment(StrictPerformanceTakeModel):
    perfStartMs: float = Field(ge=0)
    perfEndMs: float = Field(gt=0)
    mediaStartMs: float = Field(ge=0)
    mediaEndMs: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_segment_order(self) -> "RecordingTimebaseSegment":
        if self.perfEndMs <= self.perfStartMs:
            raise ValueError("perfEndMs must be greater than perfStartMs")
        if self.mediaEndMs <= self.mediaStartMs:
            raise ValueError("mediaEndMs must be greater than mediaStartMs")
        return self


class RecordingTimebase(StrictPerformanceTakeModel):
    nominalMediaDurationMs: float = Field(gt=0)
    activeSegments: list[RecordingTimebaseSegment] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_timebase(self) -> "RecordingTimebase":
        first = self.activeSegments[0]
        last = self.activeSegments[-1]
        if first.mediaStartMs != 0:
            raise ValueError("first media segment must start at zero")
        if abs(last.mediaEndMs - self.nominalMediaDurationMs) > 1:
            raise ValueError("nominal media duration must match final media segment")
        for previous, current in zip(self.activeSegments, self.activeSegments[1:]):
            if current.perfStartMs < previous.perfEndMs:
                raise ValueError("performance segments must be ordered")
            if abs(current.mediaStartMs - previous.mediaEndMs) > 1:
                raise ValueError("media segments must be continuous")
        return self


def _validate_scope_identity(
    scope_type: str,
    start_group_id: Optional[str],
    end_group_id: Optional[str],
) -> None:
    if scope_type == "RANGE":
        if not start_group_id or not end_group_id:
            raise ValueError("RANGE scope requires start and end group ids")
        return
    if start_group_id is not None or end_group_id is not None:
        raise ValueError("FULL scope must not include group ids")


class PerformanceTakeUploadAuthorizationRequest(StrictPerformanceTakeModel):
    score_id: str = Field(min_length=1, max_length=64)
    client_request_id: str = Field(min_length=1, max_length=128)
    media_kind: str = Field(default="AUDIO", pattern="^(AUDIO|VIDEO)$")
    media_byte_size: int = Field(gt=0)
    media_mime_type: str = Field(min_length=1, max_length=64)
    duration_ms: int = Field(ge=0)
    scope_type: str = Field(default="FULL", pattern="^(FULL|RANGE)$")
    scope_start_beat: float = Field(ge=0.0)
    scope_terminal_beat: float = Field(gt=0.0)
    scope_start_group_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    scope_end_group_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    revision_id: str = Field(min_length=1, max_length=64)
    artifact_id: str = Field(min_length=1, max_length=128)
    tempo_plan: PerformanceTakeTempoPlan
    recording_timebase: RecordingTimebase

    @model_validator(mode="after")
    def validate_scope_identity(self) -> "PerformanceTakeUploadAuthorizationRequest":
        _validate_scope_identity(
            self.scope_type,
            self.scope_start_group_id,
            self.scope_end_group_id,
        )
        return self


class PerformanceTakeUploadAuthorizationRead(StrictPerformanceTakeModel):
    take_id: str
    status: str = "AUTHORIZED"
    upload_url: Optional[str] = None
    upload_method: Optional[str] = None
    upload_headers: dict[str, str] = Field(default_factory=dict)
    object_key: Optional[str] = None
    reservation_id: Optional[str] = None
    expires_in: int = 0
    take: Optional["PerformanceTakeRead"] = None


class PerformanceTakeCreateRequest(StrictPerformanceTakeModel):
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
    scope_start_group_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    scope_end_group_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    revision_id: str = Field(min_length=1, max_length=64)
    artifact_id: str = Field(min_length=1, max_length=128)
    tempo_plan: PerformanceTakeTempoPlan
    recording_timebase: RecordingTimebase

    @model_validator(mode="after")
    def validate_scope_identity(self) -> "PerformanceTakeCreateRequest":
        _validate_scope_identity(
            self.scope_type,
            self.scope_start_group_id,
            self.scope_end_group_id,
        )
        return self


class PerformanceTakeRead(StrictPerformanceTakeModel):
    take_id: str
    score_id: str
    score_title: Optional[str] = None
    revision_id: str
    artifact_id: str
    media_kind: str
    media_mime_type: str
    media_byte_size: int
    duration_ms: int
    scope_type: str = "FULL"
    scope_start_beat: float
    scope_terminal_beat: float
    scope_start_group_id: Optional[str] = None
    scope_end_group_id: Optional[str] = None
    deletion_status: str = "ACTIVE"
    tempo_plan: PerformanceTakeTempoPlan
    recording_timebase: RecordingTimebase
    created_at: datetime


class PerformanceTakePlaybackRead(StrictPerformanceTakeModel):
    take_id: str
    playback_url: str
    download_url: str
    media_kind: str
    media_mime_type: str
    media_byte_size: int
    duration_ms: int
    expires_in: int


class PerformanceTakeDeleteResponse(StrictPerformanceTakeModel):
    status: str
    take_id: str


class PerformanceTakeListResponse(StrictPerformanceTakeModel):
    items: list[PerformanceTakeRead]
    total: int
    limit: int = 50
    offset: int = 0
    has_more: bool = False
