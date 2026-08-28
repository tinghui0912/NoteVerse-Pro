"""Practice target catalog derived from the score timeline."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.processing.engines.practice_alignment.musicxml_stable_ids import (
    prepared_musicxml_path_for_practice,
)
from app.processing.engines.practice_alignment.score_timeline import PracticeScoreTimeline


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
    try:
        import partitura
    except ImportError as exc:
        missing_module = getattr(exc, "name", None) or "unknown"
        raise RuntimeError(
            "Missing practice target dependency "
            f"'{missing_module}'. Install partitura before building practice targets."
        ) from exc

    with prepared_musicxml_path_for_practice(score_file_path) as prepared_path:
        score_part = partitura.load_score_as_part(str(prepared_path))
        timeline = PracticeScoreTimeline.from_note_array(
            score_part.note_array(),
            musicxml_path=prepared_path,
        )
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
