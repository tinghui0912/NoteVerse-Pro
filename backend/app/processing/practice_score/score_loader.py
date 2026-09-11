from __future__ import annotations

from pathlib import Path

from app.processing.engines.practice_alignment.musicxml_stable_ids import (
    prepared_musicxml_path_for_practice,
)
from app.processing.practice_score.partitura_adapter import load_score_as_part_for_practice
from app.processing.engines.practice_alignment.score_timeline import PracticeScoreTimeline


def practice_score_timeline_from_musicxml(score_file_path: str | Path) -> PracticeScoreTimeline:
    with prepared_musicxml_path_for_practice(score_file_path) as prepared_path:
        score_part = load_score_as_part_for_practice(str(prepared_path))
        return PracticeScoreTimeline.from_note_array(
            score_part.note_array(),
            musicxml_path=prepared_path,
        )
