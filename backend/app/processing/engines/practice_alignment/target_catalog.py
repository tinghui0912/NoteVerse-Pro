"""Practice target catalog derived from the score timeline."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.processing.practice_score.score_loader import practice_score_timeline_from_musicxml


@dataclass(frozen=True)
class PracticeTargetCatalogEntry:
    index: int
    group_id: str
    onset_beat: float
    event_ids: tuple[str, ...]
    render_note_ids: tuple[str, ...]
    pitches: tuple[str, ...]
    measure_numbers: tuple[str, ...]
    staff_ids: tuple[str, ...]
    voice_ids: tuple[str, ...]


@dataclass(frozen=True)
class PracticeTargetCatalog:
    targets: tuple[PracticeTargetCatalogEntry, ...]


def practice_target_catalog_from_musicxml(score_file_path: str | Path) -> PracticeTargetCatalog:
    timeline = practice_score_timeline_from_musicxml(score_file_path)
    return PracticeTargetCatalog(
        targets=tuple(
            PracticeTargetCatalogEntry(
                index=index,
                group_id=group.group_id,
                onset_beat=group.onset_beat,
                event_ids=group.event_ids,
                render_note_ids=group.render_note_ids,
                pitches=group.pitches,
                measure_numbers=group.measure_numbers,
                staff_ids=group.staff_ids,
                voice_ids=group.voice_ids,
            )
            for index, group in enumerate(timeline.expected_practice_groups)
        )
    )
