from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.modules.practice.planning.score_plan import MIN_PRACTICE_TEMPO_BPM, MAX_PRACTICE_TEMPO_BPM


class StrictPerformanceTakeModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


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
    segments: tuple[PerformanceTakeTempoPlanSegment, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_segments(self) -> "PerformanceTakeTempoPlan":
        if self.segments[0].startTick != 0:
            raise ValueError("tempo plan must start at tick zero")
        for previous, current in zip(self.segments, self.segments[1:]):
            if current.startTick <= previous.startTick:
                raise ValueError("tempo plan segments must be strictly ordered")
        return self


class RecordingActiveSegment(StrictPerformanceTakeModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    performanceStartUs: int = Field(strict=True, ge=0, le=2**53 - 1)
    performanceEndUs: int = Field(strict=True, gt=0, le=2**53 - 1)
    mediaStartUs: int = Field(strict=True, ge=0, le=2**53 - 1)
    mediaEndUs: int = Field(strict=True, gt=0, le=2**53 - 1)

    @model_validator(mode="after")
    def validate_segment(self) -> "RecordingActiveSegment":
        if self.performanceEndUs <= self.performanceStartUs or self.mediaEndUs <= self.mediaStartUs:
            raise ValueError("active segment durations must be positive")
        if self.performanceEndUs - self.performanceStartUs != self.mediaEndUs - self.mediaStartUs:
            raise ValueError("active performance and media durations must match exactly")
        return self


class RecordingTimebase(StrictPerformanceTakeModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    nominalMediaDurationUs: int = Field(strict=True, gt=0, le=2**53 - 1)
    activeSegments: tuple[RecordingActiveSegment, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_timebase(self) -> "RecordingTimebase":
        if self.activeSegments[0].mediaStartUs != 0:
            raise ValueError("first media segment must start at zero")
        if self.activeSegments[-1].mediaEndUs != self.nominalMediaDurationUs:
            raise ValueError("nominal media duration must match final media end exactly")
        for previous, current in zip(self.activeSegments, self.activeSegments[1:]):
            if current.performanceStartUs < previous.performanceEndUs:
                raise ValueError("performance segments must not overlap")
            if current.mediaStartUs != previous.mediaEndUs:
                raise ValueError("media segments must be exactly contiguous")
        return self


class PerformanceTakePracticeBinding(StrictPerformanceTakeModel):
    score_id: str = Field(min_length=1, max_length=128)
    revision_id: str = Field(min_length=1, max_length=128)
    bundle_id: str = Field(min_length=1, max_length=128)


class PerformanceTakeMediaMetadata(StrictPerformanceTakeModel):
    kind: Literal["AUDIO", "VIDEO"]
    byte_size: int = Field(strict=True, gt=0)
    mime_type: str = Field(min_length=1, max_length=64)


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
    practice_binding: PerformanceTakePracticeBinding
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


class PerformanceTakeManifestRead(StrictPerformanceTakeModel):
    practice_binding: PerformanceTakePracticeBinding
    artifact_id: str = Field(min_length=1)
    score_title_snapshot: str = Field(min_length=1)
    capture: PerformanceTakeMediaMetadata
    score_timebase: PerformanceTakeScoreTimebase
    scope: PerformanceTakeResolvedFullScope | PerformanceTakeResolvedRangeScope = Field(
        discriminator="kind"
    )
    tempo_plan: PerformanceTakeTempoPlan
    recording_timebase: RecordingTimebase


class PerformanceTakeUploadReservationRead(StrictPerformanceTakeModel):
    reservation_id: str
    take_id: str
    status: Literal["RESERVED", "FINALIZING", "COMPLETED"]
    manifest: PerformanceTakeManifestRead
    upload_target: PerformanceTakeUploadTarget | None = None
    take: Optional["PerformanceTakeRead"] = None


class PerformanceTakeArchiveMediaRead(StrictPerformanceTakeModel):
    mime_type: str
    byte_size: int = Field(strict=True, gt=0)


class PerformanceTakeRead(StrictPerformanceTakeModel):
    take_id: str
    manifest: PerformanceTakeManifestRead
    archive_media: PerformanceTakeArchiveMediaRead
    linked_score_id: Optional[str] = None
    can_open_score: bool = False
    deletion_status: str = "ACTIVE"
    created_at: datetime


class PerformanceTakePlaybackRead(StrictPerformanceTakeModel):
    take_id: str
    playback_url: str
    download_url: str
    media_kind: str
    media_mime_type: str
    media_byte_size: int
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
