"""Immutable compiled-domain fixtures for pure timeline projection tests."""

from app.modules.practice.score.time import PracticeScoreTimebase

from app.modules.practice.score.domain import (
    CompiledPracticeNote,
    CompiledPracticeScore,
    PracticeMeterSegment,
)


def compiled_note(
    *,
    render_note_id: str,
    onset_tick: int,
    duration_ticks: int,
    piano_key: int,
    semantic_locator: str,
    measure_number: str = "1",
    staff_id: str = "1",
    voice_id: str = "1",
    tie_types: tuple[str, ...] = (),
) -> CompiledPracticeNote:
    return CompiledPracticeNote(
        render_note_id,
        onset_tick,
        duration_ticks,
        piano_key,
        measure_number,
        staff_id,
        voice_id,
        semantic_locator,
        tie_types,
    )


def compiled_score(
    *notes: CompiledPracticeNote,
    meter_segments: tuple[PracticeMeterSegment, ...] = (PracticeMeterSegment(0, 4, 4),),
    ticks_per_quarter: int = 1,
) -> CompiledPracticeScore:
    return CompiledPracticeScore(
        notes=notes,
        meter_segments=meter_segments,
        tempo_segments=(),
        measures=(),
        timebase=PracticeScoreTimebase(ticks_per_quarter),
        score_end_tick=max((n.onset_tick + n.duration_ticks for n in notes), default=0),
    )
