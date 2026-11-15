from __future__ import annotations


from app.shared.time import Instant
from typing import Literal, Optional, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from .generated.recording_timebase import RecordingTimebase
from app.shared.api_model import ApiModel


class StrictPerformanceTakeModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PerformanceTakeScoreTimebase(StrictPerformanceTakeModel):
    """Source-local Practice written score coordinate system, resolved by the server."""

    ticks_per_quarter: int = Field(strict=True, gt=0, le=2**53 - 1)


class ScoreTempoPlanSelection(StrictPerformanceTakeModel):
    mode: Literal["SCORE"]


class CustomFixedBpmTempoPlanSelection(StrictPerformanceTakeModel):
    mode: Literal["CUSTOM_FIXED_BPM"]
    bpm: float = Field(strict=True, gt=0, allow_inf_nan=False)


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


class PerformanceTakeUploadReservationRead(ApiModel, StrictPerformanceTakeModel):
    reservation_id: str
    take_id: str
    status: Literal["RESERVED", "FINALIZING", "COMPLETED"]
    manifest: PerformanceTakeManifestRead
    upload_target: PerformanceTakeUploadTarget | None = None
    take: Optional["PerformanceTakeRead"] = None


class PerformanceTakeRecordingMediaRead(StrictPerformanceTakeModel):
    mime_type: str
    byte_size: int = Field(strict=True, gt=0)


class PerformanceTakeRead(ApiModel, StrictPerformanceTakeModel):
    take_id: str
    manifest: PerformanceTakeManifestRead
    recording_media: PerformanceTakeRecordingMediaRead
    linked_score_id: Optional[str] = None
    can_open_score: bool = False
    created_at: Instant


class PerformanceTakePlaybackRead(ApiModel, StrictPerformanceTakeModel):
    take_id: str
    playback_url: str
    download_url: str
    expires_in: int


class PerformanceTakeListResponse(ApiModel, StrictPerformanceTakeModel):
    items: list[PerformanceTakeRead]
    total: int
    limit: int = 50
    offset: int = 0
    has_more: bool = False
