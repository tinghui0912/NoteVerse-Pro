"""Pure scope and tempo planning from admitted canonical score facts."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Literal

from app.modules.practice.score.domain import PracticeTempoSegment, canonical_beat

DEFAULT_PRACTICE_TEMPO_BPM = 80
MIN_PRACTICE_TEMPO_BPM = 40
MAX_PRACTICE_TEMPO_BPM = 240


class PracticePlanningError(ValueError):
    def __init__(self, field: Literal["scope", "tempo_selection"], detail: str):
        super().__init__(detail)
        self.field = field


@dataclass(frozen=True)
class PlanningMoment:
    group_id: str
    onset_beat: float
    canonical_end_beat: float


@dataclass(frozen=True)
class PracticePlanningScore:
    moments: tuple[PlanningMoment, ...]
    score_end_beat: float
    score_tempo_segments: tuple[PracticeTempoSegment, ...]


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
    start_beat: float
    terminal_beat: float
    start_group_id: str | None = None
    end_group_id: str | None = None


@dataclass(frozen=True)
class ResolvedTempoSegment:
    start_beat: float
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
        return ResolvedPracticeScope("FULL", score.moments[0].onset_beat, score.score_end_beat)
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
        score.moments[start].onset_beat,
        canonical_beat(score.moments[end].canonical_end_beat),
        selection.start_group_id,
        selection.end_group_id,
    )


def _resolve_tempo(
    score: PracticePlanningScore, selection: TempoSelection
) -> ResolvedPracticeTempoPlan:
    if isinstance(selection, CustomTempoSelection):
        bpm = selection.bpm
        if (
            type(bpm) not in (int, float)
            or not math.isfinite(bpm)
            or not MIN_PRACTICE_TEMPO_BPM <= bpm <= MAX_PRACTICE_TEMPO_BPM
        ):
            raise PracticePlanningError(
                "tempo_selection", "Custom BPM is outside the finite product domain"
            )
        # Positive JavaScript Math.round ties go upward; retain the raw selection.
        integer = math.floor(bpm)
        rounded = integer + int(bpm - integer >= 0.5)
        return ResolvedPracticeTempoPlan(selection, (ResolvedTempoSegment(0, rounded, "CUSTOM"),))
    if not isinstance(selection, ScoreTempoSelection):
        raise PracticePlanningError("tempo_selection", "Invalid tempo selection")
    segments = tuple(
        ResolvedTempoSegment(segment.start_beat, segment.bpm, "MUSICXML")
        for segment in sorted(score.score_tempo_segments, key=lambda value: value.start_beat)
    )
    if not segments or canonical_beat(segments[0].start_beat) > 0:
        segments = (
            ResolvedTempoSegment(0, DEFAULT_PRACTICE_TEMPO_BPM, "PRODUCT_DEFAULT"),
            *segments,
        )
    return ResolvedPracticeTempoPlan(selection, segments)


def resolve_practice_score_plan(
    score: PracticePlanningScore, scope: ScopeSelection, tempo: TempoSelection
) -> PracticeScorePlan:
    return PracticeScorePlan(_resolve_scope(score, scope), _resolve_tempo(score, tempo))
