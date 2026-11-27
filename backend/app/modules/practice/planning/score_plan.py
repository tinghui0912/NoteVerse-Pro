"""Pure scope and tempo planning from admitted canonical score facts."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Literal

from app.modules.practice.score.domain import PracticeTempoSegment
from app.modules.practice.score.time import (
    ScoreTick,
    TicksPerQuarter,
    score_tick,
    ticks_per_quarter,
)

from app.score_semantics.tempo_policy import DEFAULT_SCORE_TEMPO_BPM


class PracticePlanningError(ValueError):
    def __init__(self, field: Literal["scope", "tempo_selection"], detail: str):
        super().__init__(detail)
        self.field = field


@dataclass(frozen=True)
class PlanningMoment:
    group_id: str
    onset_tick: ScoreTick
    canonical_end_tick: ScoreTick


@dataclass(frozen=True)
class PracticePlanningScore:
    moments: tuple[PlanningMoment, ...]
    score_end_tick: ScoreTick
    score_tempo_segments: tuple[PracticeTempoSegment, ...]
    ticks_per_quarter: TicksPerQuarter


@dataclass(frozen=True)
class FullScopeSelection:
    kind: Literal["FULL"] = "FULL"


@dataclass(frozen=True)
class RangeScopeSelection:
    start_group_id: str
    end_group_id: str
    kind: Literal["RANGE"] = "RANGE"


ScopeSelection = FullScopeSelection | RangeScopeSelection


@dataclass(frozen=True)
class ScoreTempoSelection:
    mode: Literal["SCORE"] = "SCORE"


@dataclass(frozen=True)
class CustomTempoSelection:
    bpm: float
    mode: Literal["CUSTOM_FIXED_BPM"] = "CUSTOM_FIXED_BPM"


TempoSelection = ScoreTempoSelection | CustomTempoSelection


@dataclass(frozen=True)
class ResolvedPracticeScope:
    kind: Literal["FULL", "RANGE"]
    start_tick: ScoreTick
    terminal_tick: ScoreTick
    start_group_id: str | None = None
    end_group_id: str | None = None


@dataclass(frozen=True)
class ResolvedTempoSegment:
    start_tick: ScoreTick
    bpm: float
    source: Literal["MUSICXML", "PRODUCT_DEFAULT", "CUSTOM"]


@dataclass(frozen=True)
class ResolvedPracticeTempoPlan:
    selection: TempoSelection
    segments: tuple[ResolvedTempoSegment, ...]


@dataclass(frozen=True)
class PracticeScorePlan:
    scope: ResolvedPracticeScope
    tempo_plan: ResolvedPracticeTempoPlan


def _resolve_scope(
    score: PracticePlanningScore, selection: ScopeSelection
) -> ResolvedPracticeScope:
    if not score.moments:
        raise PracticePlanningError("scope", "Scope requires a canonical Practice moment")
    if isinstance(selection, FullScopeSelection):
        return ResolvedPracticeScope("FULL", score.moments[0].onset_tick, score.score_end_tick)
    if (
        not isinstance(selection, RangeScopeSelection)
        or not selection.start_group_id
        or not selection.end_group_id
    ):
        raise PracticePlanningError("scope", "Range requires both moment identities")
    positions = {moment.group_id: index for index, moment in enumerate(score.moments)}
    start = positions.get(selection.start_group_id)
    end = positions.get(selection.end_group_id)
    if start is None or end is None or end < start:
        raise PracticePlanningError("scope", "Invalid canonical moment range")
    return ResolvedPracticeScope(
        "RANGE",
        score.moments[start].onset_tick,
        score.moments[end].canonical_end_tick,
        selection.start_group_id,
        selection.end_group_id,
    )


def _resolve_tempo(
    score: PracticePlanningScore, selection: TempoSelection
) -> ResolvedPracticeTempoPlan:
    if isinstance(selection, CustomTempoSelection):
        bpm = selection.bpm
        if type(bpm) not in (int, float) or not math.isfinite(bpm) or bpm <= 0:
            raise PracticePlanningError(
                "tempo_selection", "Custom BPM must be a finite positive number"
            )
        return ResolvedPracticeTempoPlan(selection, (ResolvedTempoSegment(0, bpm, "CUSTOM"),))
    if not isinstance(selection, ScoreTempoSelection):
        raise PracticePlanningError("tempo_selection", "Invalid tempo selection")
    if any(
        type(segment.start_tick) is not int
        or segment.start_tick < 0
        or not math.isfinite(segment.bpm)
        or segment.bpm <= 0
        for segment in score.score_tempo_segments
    ):
        raise PracticePlanningError("tempo_selection", "Invalid explicit score tempo")
    segments = tuple(
        ResolvedTempoSegment(segment.start_tick, segment.bpm, "MUSICXML")
        for segment in sorted(score.score_tempo_segments, key=lambda value: value.start_tick)
    )
    if not segments or segments[0].start_tick > 0:
        segments = (
            ResolvedTempoSegment(0, DEFAULT_SCORE_TEMPO_BPM, "PRODUCT_DEFAULT"),
            *segments,
        )
    return ResolvedPracticeTempoPlan(selection, segments)


def resolve_practice_score_plan(
    score: PracticePlanningScore, scope: ScopeSelection, tempo: TempoSelection
) -> PracticeScorePlan:
    ticks_per_quarter(score.ticks_per_quarter)
    score_tick(score.score_end_tick)
    for moment in score.moments:
        score_tick(moment.onset_tick)
        score_tick(moment.canonical_end_tick)
    for segment in score.score_tempo_segments:
        score_tick(segment.start_tick)
    return PracticeScorePlan(_resolve_scope(score, scope), _resolve_tempo(score, tempo))
