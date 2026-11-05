from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.modules.practice.planning.score_plan import MIN_PRACTICE_TEMPO_BPM, MAX_PRACTICE_TEMPO_BPM


class StrictPerformanceTakeModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PerformanceTakeScoreTimebase(StrictPerformanceTakeModel):
    """Source-local Practice written score coordinate system, resolved by the server."""

    ticks_per_quarter: int = Field(strict=True, gt=0, le=2**53 - 1)


class ScoreTempoPlanSelection(StrictPerformanceTakeModel):
    mode: Literal["SCORE"]


class CustomFixedBpmTempoPlanSelection(StrictPerformanceTakeModel):
    mode: Literal["CUSTOM_FIXED_BPM"]
    bpm: float = Field(
        strict=True, ge=MIN_PRACTICE_TEMPO_BPM, le=MAX_PRACTICE_TEMPO_BPM, allow_inf_nan=False
    )


TempoPlanSelection = ScoreTempoPlanSelection | CustomFixedBpmTempoPlanSelection


class PerformanceTakeTempoPlanSegment(StrictPerformanceTakeModel):
    startTick: int = Field(strict=True, ge=0, le=2**53 - 1)
    bpm: float = Field(gt=0, allow_inf_nan=False)
    source: str = Field(pattern="^(MUSICXML|PRODUCT_DEFAULT|CUSTOM)$")


class PerformanceTakeTempoPlan(StrictPerformanceTakeModel):
    selection: TempoPlanSelection = Field(discriminator="mode")
    segments: list[PerformanceTakeTempoPlanSegment] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_segments(self) -> "PerformanceTakeTempoPlan":
        if self.segments[0].startTick != 0:
            raise ValueError("tempo plan must start at tick zero")
        for previous, current in zip(self.segments, self.segments[1:]):
            if current.startTick <= previous.startTick:
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


class PerformanceTakeSourceIdentity(StrictPerformanceTakeModel):
    source_id: str = Field(min_length=1, max_length=128)


class PerformanceTakeMediaMetadata(StrictPerformanceTakeModel):
    kind: Literal["AUDIO", "VIDEO"]
    byte_size: int = Field(gt=0)
    mime_type: str = Field(min_length=1, max_length=64)
    duration_ms: int = Field(ge=0)


class PerformanceTakeFullScopeSelection(StrictPerformanceTakeModel):
    kind: Literal["FULL"]


class PerformanceTakeRangeScopeSelection(StrictPerformanceTakeModel):
    kind: Literal["RANGE"]
    start_group_id: str = Field(min_length=1, max_length=128)
    end_group_id: str = Field(min_length=1, max_length=128)


class _PerformanceTakeScoreScope(StrictPerformanceTakeModel):
    start_tick: int = Field(strict=True, ge=0, le=2**53 - 1)
    terminal_tick: int = Field(strict=True, gt=0, le=2**53 - 1)

    @model_validator(mode="after")
    def validate_scope_order(self) -> Self:
        if self.terminal_tick < self.start_tick:
            raise ValueError("score scope terminal must not precede its start")
        return self


class PerformanceTakeResolvedFullScope(_PerformanceTakeScoreScope):
    kind: Literal["FULL"]


class PerformanceTakeResolvedRangeScope(_PerformanceTakeScoreScope):
    kind: Literal["RANGE"]
    start_group_id: str = Field(min_length=1, max_length=128)
    end_group_id: str = Field(min_length=1, max_length=128)


class PerformanceTakeUploadMetadata(StrictPerformanceTakeModel):
    source: PerformanceTakeSourceIdentity
    media: PerformanceTakeMediaMetadata
    scope: PerformanceTakeFullScopeSelection | PerformanceTakeRangeScopeSelection = Field(
        discriminator="kind"
    )
    tempo_selection: TempoPlanSelection = Field(discriminator="mode")
    recording_timebase: RecordingTimebase


class PerformanceTakeUploadReservationRequest(PerformanceTakeUploadMetadata):
    client_request_id: str = Field(min_length=1, max_length=128)


class PerformanceTakeUploadTarget(StrictPerformanceTakeModel):
    url: str
    method: str
    headers: dict[str, str]
    expires_in: int


class PerformanceTakeUploadReservationRead(StrictPerformanceTakeModel):
    reservation_id: str
    take_id: str
    status: Literal["RESERVED", "FINALIZING", "COMPLETED"]
    metadata: PerformanceTakeUploadMetadata
    resolved_scope: PerformanceTakeResolvedFullScope | PerformanceTakeResolvedRangeScope = Field(
        discriminator="kind"
    )
    resolved_tempo_plan: PerformanceTakeTempoPlan
    score_timebase: PerformanceTakeScoreTimebase
    upload_target: PerformanceTakeUploadTarget | None = None
    take: Optional["PerformanceTakeRead"] = None


class PerformanceTakeRead(StrictPerformanceTakeModel):
    take_id: str
    source_id: str
    source_score_id: str
    source_revision_id: str
    source_artifact_id: str
    score_title_snapshot: str = Field(min_length=1)
    linked_score_id: Optional[str] = None
    can_open_score: bool = False
    media_kind: str
    media_mime_type: str
    media_byte_size: int
    duration_ms: int
    scope_type: str
    scope_start_tick: int = Field(strict=True, ge=0, le=2**53 - 1)
    scope_terminal_tick: int = Field(strict=True, gt=0, le=2**53 - 1)
    scope_start_group_id: Optional[str] = None
    scope_end_group_id: Optional[str] = None
    deletion_status: str = "ACTIVE"
    tempo_plan: PerformanceTakeTempoPlan
    score_timebase: PerformanceTakeScoreTimebase
    recording_timebase: RecordingTimebase
    created_at: datetime

    @model_validator(mode="after")
    def validate_scope_order(self) -> Self:
        if self.scope_terminal_tick < self.scope_start_tick:
            raise ValueError("score scope terminal must not precede its start")
        return self


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
