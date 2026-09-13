"""Build a small DEV selection for Basic Pitch activation tuning.

The DEV selection is intentionally separate from the frozen P3 held-out
selection. It excludes source groups already present in a reference manifest and
can require no subsequent physical strike within the target horizon.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from evaluate_public_paired_midi_dataset import (
    DEFAULT_CHORD_WINDOW_SECONDS,
    DEFAULT_SAMPLE_RATE,
    DEFAULT_WINDOW_SECONDS,
    build_selection_manifest,
    classify_groups,
    group_note_ons,
    load_selection_manifest,
    parse_midi_note_ons,
    read_pcm_wav,
)
from evaluate_transkun_bounded_clips import _later_truth_pitches
from evaluate_score_conditioned_step_cases import StepCase


def main() -> int:
    args = parse_args()
    manifest = build_basic_pitch_activation_dev_selection(
        audio_path=args.audio,
        midi_path=args.midi,
        exclude_selection_manifest=args.exclude_selection_manifest,
        sample_rate=args.sample_rate,
        window_seconds=args.window_seconds,
        chord_window_seconds=args.chord_window_seconds,
        horizon_seconds=args.horizon_seconds,
        require_no_subsequent_strike=args.require_no_subsequent_strike,
        max_groups=args.max_groups,
        dataset_id=args.dataset_id,
        dataset_version=args.dataset_version,
        official_split=args.official_split,
        recording_id=args.recording_id,
    )
    text = json.dumps(manifest, ensure_ascii=False, indent=2)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def build_basic_pitch_activation_dev_selection(
    *,
    audio_path: Path,
    midi_path: Path,
    exclude_selection_manifest: Path,
    sample_rate: int,
    window_seconds: float,
    chord_window_seconds: float,
    horizon_seconds: float,
    require_no_subsequent_strike: bool,
    max_groups: int,
    dataset_id: str | None,
    dataset_version: str | None,
    official_split: str | None,
    recording_id: str | None,
) -> dict[str, object]:
    audio = read_pcm_wav(audio_path, sample_rate=sample_rate)
    groups = group_note_ons(
        parse_midi_note_ons(midi_path),
        chord_window_seconds=chord_window_seconds,
    )
    groups = tuple(
        group
        for group in groups
        if group.seconds + window_seconds <= audio.size / sample_rate
    )
    group_buckets = classify_groups(groups)
    excluded = _excluded_source_indices(exclude_selection_manifest)
    selected_indices: list[int] = []
    for index, group in enumerate(groups):
        if index in excluded:
            continue
        if require_no_subsequent_strike and _later_truth_pitches(
            StepCase(
                case_id=f"g{index:04d}:selection",
                kind="positive",
                seconds=group.seconds,
                actual_pitches=group.pitches,
                expected_pitches=group.pitches,
                source_group_index=index,
                mutation={},
            ),
            truth_groups=groups,
            horizon_seconds=horizon_seconds,
        ):
            continue
        selected_indices.append(index)
        if len(selected_indices) >= max_groups:
            break

    selected_groups = tuple(groups[index] for index in selected_indices)
    selected_buckets = tuple(group_buckets[index] for index in selected_indices)
    return build_selection_manifest(
        audio_path=audio_path,
        midi_path=midi_path,
        dataset_id=dataset_id,
        dataset_version=dataset_version,
        official_split=official_split,
        recording_id=recording_id,
        groups=selected_groups,
        group_buckets=selected_buckets,
        all_groups=groups,
        sample_rate=sample_rate,
        window_seconds=window_seconds,
        chord_window_seconds=chord_window_seconds,
        selection={
            "mode": "basic_pitch_activation_dev",
            "excluded_manifest_path": str(exclude_selection_manifest),
            "excluded_source_group_count": len(excluded),
            "require_no_subsequent_strike": require_no_subsequent_strike,
            "horizon_seconds": horizon_seconds,
            "selected_source_indices": selected_indices,
        },
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--midi", type=Path, required=True)
    parser.add_argument("--exclude-selection-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE)
    parser.add_argument("--window-seconds", type=float, default=DEFAULT_WINDOW_SECONDS)
    parser.add_argument("--chord-window-seconds", type=float, default=DEFAULT_CHORD_WINDOW_SECONDS)
    parser.add_argument("--horizon-seconds", type=float, default=0.5)
    parser.add_argument("--require-no-subsequent-strike", action="store_true")
    parser.add_argument("--max-groups", type=int, default=24)
    parser.add_argument("--dataset-id", default=None)
    parser.add_argument("--dataset-version", default=None)
    parser.add_argument("--official-split", default=None)
    parser.add_argument("--recording-id", default=None)
    return parser.parse_args()


def _excluded_source_indices(path: Path) -> set[int]:
    manifest = load_selection_manifest(path)
    groups = manifest.get("groups")
    if not isinstance(groups, list):
        raise ValueError(f"Selection manifest has no groups: {path}")
    indices: set[int] = set()
    for item in groups:
        if not isinstance(item, dict):
            continue
        source_index = item.get("source_index")
        if isinstance(source_index, int):
            indices.add(source_index)
    return indices


if __name__ == "__main__":
    raise SystemExit(main())
