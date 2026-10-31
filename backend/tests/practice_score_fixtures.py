"""Immutable compiled-domain fixtures for pure timeline projection tests."""

from app.modules.practice.score.domain import (
    CompiledPracticeNote,
    CompiledPracticeScore,
    PracticeMeterSegment,
)


def compiled_note(
    *,
    render_note_id: str,
    onset_beat: float,
    duration_beats: float,
    piano_key: int,
    semantic_locator: str,
    measure_number: str = "1",
    staff_id: str = "1",
    voice_id: str = "1",
    tie_types: tuple[str, ...] = (),
) -> CompiledPracticeNote:
    return CompiledPracticeNote(
        render_note_id,
        onset_beat,
        duration_beats,
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
) -> CompiledPracticeScore:
    return CompiledPracticeScore(
        notes=notes, meter_segments=meter_segments, tempo_segments=(), measures=()
    )
