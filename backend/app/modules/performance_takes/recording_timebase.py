"""Recording chronology and exact-rate semantics over the generated structural contract."""

from pydantic import model_validator
from .generated.recording_timebase_contract import (
    RecordingActiveSegmentStructure,
    RecordingTimebaseStructure,
)


class RecordingActiveSegment(RecordingActiveSegmentStructure):
    @model_validator(mode="after")
    def validate_segment(self) -> "RecordingActiveSegment":
        if self.performanceEndUs <= self.performanceStartUs or self.mediaEndUs <= self.mediaStartUs:
            raise ValueError("active segment durations must be positive")
        if self.performanceEndUs - self.performanceStartUs != self.mediaEndUs - self.mediaStartUs:
            raise ValueError("active performance and media durations must match exactly")
        return self


class RecordingTimebase(RecordingTimebaseStructure[RecordingActiveSegment]):
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
