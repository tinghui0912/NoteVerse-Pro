"""Exact performance-axis contract shared by playback consumers."""

from dataclasses import dataclass
from fractions import Fraction

from .musicxml_score import CanonicalScoreSemanticModel
from .performance_navigation import (
    PerformanceProjection,
    WrittenPerformanceFact,
    project_performance_occurrences,
)
from .tempo_policy import DEFAULT_SCORE_TEMPO_BPM


@dataclass(frozen=True)
class PerformanceTempoEvent:
    occurrence_ordinal: int
    position: Fraction
    bpm: Fraction


@dataclass(frozen=True)
class CanonicalPerformancePlan:
    projection: PerformanceProjection
    initial_tempo_bpm: Fraction
    tempo_events: tuple[PerformanceTempoEvent, ...]


def build_performance_plan(model: CanonicalScoreSemanticModel) -> CanonicalPerformancePlan:
    projection = project_performance_occurrences(model)
    tempos = projection.project_facts([WrittenPerformanceFact(t.point, t) for t in model.tempos])
    return CanonicalPerformancePlan(
        projection,
        Fraction(DEFAULT_SCORE_TEMPO_BPM),
        tuple(
            PerformanceTempoEvent(t.occurrence_ordinal, t.position, t.value.quarter_bpm)
            for t in tempos
        ),
    )
