"""Exact transient performance-plan HTTP contracts."""

from fractions import Fraction

from pydantic import BaseModel, Field
from app.shared.api_model import ApiModel


class PerformancePlanRequest(BaseModel):
    musicxml: str = Field(min_length=1)


class RationalRead(BaseModel):
    numerator: int
    denominator: int = Field(gt=0)

    @classmethod
    def from_fraction(cls, value: Fraction) -> "RationalRead":
        return cls(numerator=value.numerator, denominator=value.denominator)


class PerformanceOccurrenceRead(BaseModel):
    ordinal: int
    measure_index: int
    visit: int
    written_start: RationalRead
    written_end: RationalRead
    performance_start: RationalRead
    performance_end: RationalRead


class PerformanceTempoEventRead(BaseModel):
    occurrence_ordinal: int
    performance_position: RationalRead
    bpm: RationalRead


class PerformancePlanRead(ApiModel):
    musicxml: str
    performance_end: RationalRead
    initial_tempo_bpm: RationalRead
    occurrences: list[PerformanceOccurrenceRead]
    tempo_events: list[PerformanceTempoEventRead]
