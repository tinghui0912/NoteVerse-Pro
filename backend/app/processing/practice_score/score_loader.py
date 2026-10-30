from __future__ import annotations

from pathlib import Path

from app.processing.practice_score.partitura_adapter import load_score_as_part_for_practice
from app.processing.practice_score.score_timeline import PracticeScoreTimeline


def practice_score_timeline_from_prepared_musicxml(
    prepared_path: str | Path,
) -> PracticeScoreTimeline:
    """Load notation and timing from the caller's already-prepared MusicXML file."""
    score_part = load_score_as_part_for_practice(str(prepared_path))
    return PracticeScoreTimeline.from_note_array(
        score_part.note_array(), musicxml_path=prepared_path
    )
