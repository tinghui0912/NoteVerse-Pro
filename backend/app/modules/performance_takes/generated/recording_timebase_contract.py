"""Generated from contracts/practice/recording-timebase.schema.json. Do not edit."""

from typing import Generic, TypeVar
from pydantic import BaseModel, ConfigDict, Field

MAX_RECORDING_COORDINATE = 9007199254740991


class RecordingActiveSegmentStructure(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    performanceStartUs: int = Field(strict=True, ge=0, le=MAX_RECORDING_COORDINATE)
    performanceEndUs: int = Field(strict=True, gt=0, le=MAX_RECORDING_COORDINATE)
    mediaStartUs: int = Field(strict=True, ge=0, le=MAX_RECORDING_COORDINATE)
    mediaEndUs: int = Field(strict=True, gt=0, le=MAX_RECORDING_COORDINATE)


Segment = TypeVar("Segment", bound=RecordingActiveSegmentStructure)


class RecordingTimebaseStructure(BaseModel, Generic[Segment]):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    nominalMediaDurationUs: int = Field(strict=True, gt=0, le=MAX_RECORDING_COORDINATE)
    activeSegments: tuple[Segment, ...] = Field(min_length=1)
