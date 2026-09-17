"""Practice target catalog derived from the score timeline."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.processing.practice_score.score_loader import practice_score_timeline_from_musicxml
from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    PracticeAttackStep,
    PracticeAttackTarget,
    PracticeScoreTimeline,
    PracticeStepNote,
)


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
    step_id: str
    attack_targets: tuple[PracticeAttackTarget, ...]
    continuation: tuple[PracticeStepNote, ...]


@dataclass(frozen=True)
class PracticeTargetCatalog:
    targets: tuple[PracticeTargetCatalogEntry, ...]


def practice_target_catalog_from_musicxml(score_file_path: str | Path) -> PracticeTargetCatalog:
    timeline = practice_score_timeline_from_musicxml(score_file_path)
    return practice_target_catalog_from_timeline(timeline)


def practice_target_catalog_from_timeline(timeline: PracticeScoreTimeline) -> PracticeTargetCatalog:
    attack_steps_by_onset = _attack_steps_by_onset(timeline.practice_attack_steps)
    return PracticeTargetCatalog(
        targets=tuple(
            _catalog_entry(index, group, attack_steps_by_onset)
            for index, group in enumerate(timeline.expected_practice_groups)
        )
    )


def _attack_steps_by_onset(
    attack_steps: tuple[PracticeAttackStep, ...],
) -> dict[float, PracticeAttackStep]:
    steps_by_onset: dict[float, PracticeAttackStep] = {}
    for step in attack_steps:
        if step.onset_beat in steps_by_onset:
            raise ValueError(f"duplicate practice attack step at onset {step.onset_beat}")
        steps_by_onset[step.onset_beat] = step
    return steps_by_onset


def _catalog_entry(
    index: int,
    group: ExpectedPracticeGroup,
    attack_steps_by_onset: dict[float, PracticeAttackStep],
) -> PracticeTargetCatalogEntry:
    try:
        step = attack_steps_by_onset[group.onset_beat]
    except KeyError as exc:
        raise ValueError(f"missing practice attack step for target {group.group_id}") from exc

    group_pitches = set(group.pitches)
    attack_pitches = {target.pitch for target in step.attack_targets}
    if group_pitches != attack_pitches:
        raise ValueError(
            "practice target attack pitches do not match expected group pitches: "
            f"group_id={group.group_id} expected={sorted(group_pitches)} actual={sorted(attack_pitches)}"
        )

    return PracticeTargetCatalogEntry(
        index=index,
        group_id=group.group_id,
        onset_beat=group.onset_beat,
        event_ids=group.event_ids,
        render_note_ids=group.render_note_ids,
        pitches=group.pitches,
        measure_numbers=group.measure_numbers,
        staff_ids=group.staff_ids,
        voice_ids=group.voice_ids,
        step_id=step.step_id,
        attack_targets=step.attack_targets,
        continuation=step.continuation,
    )
