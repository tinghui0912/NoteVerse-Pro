"""Immutable canonical Practice score facts. One score beat is one quarter note."""

from __future__ import annotations
from dataclasses import dataclass
import math
from typing import Literal, SupportsFloat
from .piano_key import PracticeScoreInvalidError


def canonical_beat(value: SupportsFloat) -> float:
    try:
        result = round(float(value), 6)
    except (ValueError, OverflowError) as cause:
        raise PracticeScoreInvalidError("Unrepresentable Practice beat position.") from cause
    if not math.isfinite(result):
        raise PracticeScoreInvalidError("Nonfinite Practice beat position.")
    return result


ScoreBeat = float
MeterSource = Literal["MUSICXML"]


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
    onset_beat: ScoreBeat
    duration_beats: ScoreBeat


@dataclass(frozen=True)
class PracticeAttack:
    attack_id: str
    piano_key: int
    note_ids: tuple[str, ...]


@dataclass(frozen=True)
class PracticeMoment:
    group_id: str
    onset_beat: ScoreBeat
    canonical_end_beat: ScoreBeat
    attacks: tuple[PracticeAttack, ...]
    continuation_note_ids: tuple[str, ...]


@dataclass(frozen=True)
class PracticeMeterSegment:
    start_beat: ScoreBeat
    numerator: int
    denominator: int
    source: MeterSource = "MUSICXML"

    @property
    def measure_duration_beats(self) -> ScoreBeat:
        try:
            duration = canonical_beat(self.numerator * 4.0 / self.denominator)
        except (OverflowError, ZeroDivisionError) as error:
            raise PracticeScoreInvalidError("Invalid Practice meter duration.") from error
        if not math.isfinite(duration) or duration <= 0:
            raise PracticeScoreInvalidError("Invalid Practice meter duration.")
        return duration

    @property
    def count_in_pulses(self) -> int:
        return self.numerator


@dataclass(frozen=True)
class CompiledPracticeNote:
    render_note_id: str
    onset_beat: ScoreBeat
    duration_beats: ScoreBeat
    piano_key: int
    measure_number: str
    staff_id: str
    voice_id: str
    semantic_locator: str
    tie_types: tuple[str, ...]


@dataclass(frozen=True)
class PracticeTempoSegment:
    start_beat: ScoreBeat
    bpm: float


@dataclass(frozen=True)
class CompiledPracticeMeasure:
    index: int
    start_beat: ScoreBeat
    end_beat: ScoreBeat
    uses_meter_duration: bool


@dataclass(frozen=True)
class CompiledPracticeScore:
    notes: tuple[CompiledPracticeNote, ...]
    meter_segments: tuple[PracticeMeterSegment, ...]
    tempo_segments: tuple[PracticeTempoSegment, ...]
    measures: tuple[CompiledPracticeMeasure, ...]


@dataclass(frozen=True)
class PracticeScoreTimeline:
    notes: tuple[PracticeScoreNote, ...]
    events: tuple[PracticeScoreEvent, ...]
    moments: tuple[PracticeMoment, ...]
    first_playable_beat: ScoreBeat | None
    end_beat: ScoreBeat
    meter_segments: tuple[PracticeMeterSegment, ...]

    @property
    def playable_onset_beats(self) -> tuple[ScoreBeat, ...]:
        return tuple(moment.onset_beat for moment in self.moments)

    def meter_at(self, beat: ScoreBeat) -> PracticeMeterSegment:
        if not self.meter_segments or self.meter_segments[0].start_beat != 0:
            raise PracticeScoreInvalidError("Practice requires explicit initial meter timing.")
        active = self.meter_segments[0]
        for segment in self.meter_segments:
            if segment.start_beat > max(0.0, float(beat)):
                break
            active = segment
        return active

    def count_in_duration_beats_at(self, beat: ScoreBeat) -> ScoreBeat:
        return self.meter_at(beat).measure_duration_beats

    def count_in_pulses_at(self, beat: ScoreBeat) -> int:
        return self.meter_at(beat).count_in_pulses
