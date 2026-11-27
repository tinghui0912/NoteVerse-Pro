"""Immutable Practice facts on one exact source-local integer score axis."""

from __future__ import annotations
from dataclasses import dataclass
from .piano_key import PracticeScoreInvalidError
from .time import (
    MAX_JSON_SAFE_INTEGER,
    ScoreTick,
    TicksPerQuarter,
    PracticeScoreTimebase,
    score_tick,
)


@dataclass(frozen=True)
class PracticeScoreNote:
    note_id: str
    event_id: str
    piano_key: int
    render_note_id: str
    measure_number: str
    staff_id: str
    voice_id: str
    tie_types: tuple[str, ...]


@dataclass(frozen=True)
class PracticeScoreEvent:
    event_id: str
    onset_tick: ScoreTick
    duration_ticks: ScoreTick


@dataclass(frozen=True)
class PracticeAttack:
    attack_id: str
    piano_key: int
    note_ids: tuple[str, ...]


@dataclass(frozen=True)
class PracticeMoment:
    group_id: str
    onset_tick: ScoreTick
    canonical_end_tick: ScoreTick
    attacks: tuple[PracticeAttack, ...]
    continuation_note_ids: tuple[str, ...]


@dataclass(frozen=True)
class PracticeMeterSegment:
    start_tick: ScoreTick
    numerator: int
    denominator: int

    def __post_init__(self) -> None:
        for value in (self.numerator, self.denominator):
            if type(value) is not int or not 1 <= value <= MAX_JSON_SAFE_INTEGER:
                raise PracticeScoreInvalidError(
                    "Practice meter facts require positive JSON-safe integers."
                )

    def measure_duration_ticks(self, resolution: TicksPerQuarter) -> ScoreTick:
        return PracticeScoreTimebase(resolution).meter_duration_ticks(
            self.numerator, self.denominator
        )


@dataclass(frozen=True)
class CompiledPracticeNote:
    render_note_id: str
    onset_tick: ScoreTick
    duration_ticks: ScoreTick
    piano_key: int
    measure_number: str
    staff_id: str
    voice_id: str
    semantic_locator: str
    tie_types: tuple[str, ...]


@dataclass(frozen=True)
class PracticeTempoSegment:
    start_tick: ScoreTick
    bpm: float


@dataclass(frozen=True)
class CompiledPracticeMeasure:
    index: int
    start_tick: ScoreTick
    end_tick: ScoreTick
    uses_meter_duration: bool


@dataclass(frozen=True)
class CompiledPracticeScore:
    notes: tuple[CompiledPracticeNote, ...]
    meter_segments: tuple[PracticeMeterSegment, ...]
    tempo_segments: tuple[PracticeTempoSegment, ...]
    measures: tuple[CompiledPracticeMeasure, ...]
    timebase: PracticeScoreTimebase
    score_end_tick: ScoreTick


@dataclass(frozen=True)
class PracticeScoreTimeline:
    notes: tuple[PracticeScoreNote, ...]
    events: tuple[PracticeScoreEvent, ...]
    moments: tuple[PracticeMoment, ...]
    score_end_tick: ScoreTick
    ticks_per_quarter: TicksPerQuarter
    meter_segments: tuple[PracticeMeterSegment, ...]

    @property
    def playable_onset_ticks(self) -> tuple[ScoreTick, ...]:
        return tuple(moment.onset_tick for moment in self.moments)

    def meter_at(self, tick: ScoreTick) -> PracticeMeterSegment:
        if not self.meter_segments or self.meter_segments[0].start_tick != 0:
            raise PracticeScoreInvalidError("Practice requires explicit initial meter timing.")
        active = self.meter_segments[0]
        for segment in self.meter_segments:
            if segment.start_tick > score_tick(tick):
                break
            active = segment
        return active
