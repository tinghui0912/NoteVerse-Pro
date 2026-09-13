"""Evaluate provider MIDI transcription inside frozen paired-MIDI truth windows.

This benchmark is intentionally separate from oracle-onset acoustic observation.
The provider owns note onset detection and pitch transcription, but precision is
computed only inside the frozen selected truth windows. This is a
STEP-relevant provider comparison, not a full-recording AMT precision benchmark.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import median

from evaluate_public_paired_midi_dataset import (
    BENCHMARK_SCOPE_PAIRED_MIDI_ORACLE_ONSET,
    MidiStrikeGroup,
    _file_sha256,
    group_note_ons,
    load_selection_manifest,
    parse_midi_note_ons,
)


BENCHMARK_SCOPE_SELECTED_TRUTH_WINDOW_TRANSCRIPTION = "selected_truth_window_transcription"
DEFAULT_ONSET_TOLERANCE_SECONDS = 0.08
DEFAULT_CHORD_WINDOW_SECONDS = 0.05


def main() -> int:
    args = parse_args()
    manifest = load_selection_manifest(args.selection_manifest)
    truth_groups = load_truth_groups_from_manifest(manifest)
    predicted_groups = group_note_ons(
        parse_midi_note_ons(args.predicted_midi),
        chord_window_seconds=args.chord_window_seconds,
    )
    evaluations = evaluate_transcription(
        truth_groups,
        predicted_groups=predicted_groups,
        onset_tolerance_seconds=args.onset_tolerance_seconds,
    )
    report = build_report(
        manifest=manifest,
        selection_manifest_path=args.selection_manifest,
        predicted_midi_path=args.predicted_midi,
        provider_id=args.provider_id,
        provider_version=args.provider_version,
        provider_checkpoint=args.provider_checkpoint,
        onset_tolerance_seconds=args.onset_tolerance_seconds,
        chord_window_seconds=args.chord_window_seconds,
        predicted_group_count=len(predicted_groups),
        evaluations=evaluations,
    )
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection-manifest", type=Path, required=True)
    parser.add_argument("--predicted-midi", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--provider-id", required=True)
    parser.add_argument("--provider-version", default=None)
    parser.add_argument("--provider-checkpoint", default=None)
    parser.add_argument(
        "--onset-tolerance-seconds",
        type=float,
        default=DEFAULT_ONSET_TOLERANCE_SECONDS,
    )
    parser.add_argument(
        "--chord-window-seconds",
        type=float,
        default=DEFAULT_CHORD_WINDOW_SECONDS,
    )
    return parser.parse_args()


def load_truth_groups_from_manifest(manifest: dict[str, object]) -> tuple[MidiStrikeGroup, ...]:
    benchmark = manifest.get("benchmark", {})
    if not isinstance(benchmark, dict):
        raise ValueError("Selection manifest benchmark must be an object")
    if benchmark.get("benchmark_scope") != BENCHMARK_SCOPE_PAIRED_MIDI_ORACLE_ONSET:
        raise ValueError("Selection manifest must be based on paired MIDI truth")
    manifest_groups = manifest.get("groups")
    if not isinstance(manifest_groups, list):
        raise ValueError("Selection manifest groups must be a list")

    groups: list[MidiStrikeGroup] = []
    for item in manifest_groups:
        if not isinstance(item, dict):
            raise ValueError("Selection manifest group must be an object")
        seconds = item.get("seconds")
        truth_pitches = item.get("truth_pitches")
        midi_notes = item.get("midi_notes")
        if not isinstance(seconds, int | float):
            raise ValueError("Selection manifest group seconds must be numeric")
        if not isinstance(truth_pitches, list):
            raise ValueError("Selection manifest group truth_pitches must be a list")
        if not isinstance(midi_notes, list):
            raise ValueError("Selection manifest group midi_notes must be a list")
        groups.append(
            MidiStrikeGroup(
                seconds=float(seconds),
                pitches=tuple(str(pitch) for pitch in truth_pitches),
                midi_notes=tuple(int(note) for note in midi_notes),
            )
        )
    return tuple(groups)


def evaluate_transcription(
    truth_groups: tuple[MidiStrikeGroup, ...],
    *,
    predicted_groups: tuple[MidiStrikeGroup, ...],
    onset_tolerance_seconds: float,
) -> list[dict[str, object]]:
    assignments = assign_predicted_groups(
        truth_groups,
        predicted_groups=predicted_groups,
        onset_tolerance_seconds=onset_tolerance_seconds,
    )
    assigned_prediction_indices = set(assignments.values())
    unassigned_predictions_by_truth = unassigned_predictions_in_truth_windows(
        truth_groups,
        predicted_groups=predicted_groups,
        assigned_prediction_indices=assigned_prediction_indices,
        onset_tolerance_seconds=onset_tolerance_seconds,
    )
    evaluations: list[dict[str, object]] = []
    for truth_index, truth_group in enumerate(truth_groups):
        prediction = assignments.get(truth_index)
        predicted_group = None if prediction is None else predicted_groups[prediction]
        unassigned_predictions = unassigned_predictions_by_truth.get(truth_index, ())
        predicted_pitches = tuple(
            dict.fromkeys(
                (
                    *((() if predicted_group is None else predicted_group.pitches)),
                    *(
                        pitch
                        for unassigned_prediction in unassigned_predictions
                        for pitch in unassigned_prediction.pitches
                    ),
                )
            )
        )
        predicted_pitch_set = set(predicted_pitches)
        truth_pitch_set = set(truth_group.pitches)
        matched = tuple(pitch for pitch in truth_group.pitches if pitch in predicted_pitch_set)
        onset_error_seconds = (
            None
            if predicted_group is None
            else round(predicted_group.seconds - truth_group.seconds, 6)
        )
        evaluations.append(
            {
                "seconds": round(truth_group.seconds, 6),
                "truth_pitches": truth_group.pitches,
                "predicted_seconds": None if predicted_group is None else round(predicted_group.seconds, 6),
                "predicted_pitches": predicted_pitches,
                "onset_error_seconds": onset_error_seconds,
                "unassigned_predicted_groups": tuple(
                    {
                        "seconds": round(unassigned_prediction.seconds, 6),
                        "pitches": unassigned_prediction.pitches,
                    }
                    for unassigned_prediction in unassigned_predictions
                ),
                "matched_truth": matched,
                "missing_truth": tuple(
                    pitch for pitch in truth_group.pitches if pitch not in predicted_pitch_set
                ),
                "extra_predicted": tuple(
                    pitch for pitch in predicted_pitches if pitch not in truth_pitch_set
                ),
            }
        )
    return evaluations


def unassigned_predictions_in_truth_windows(
    truth_groups: tuple[MidiStrikeGroup, ...],
    *,
    predicted_groups: tuple[MidiStrikeGroup, ...],
    assigned_prediction_indices: set[int],
    onset_tolerance_seconds: float,
) -> dict[int, tuple[MidiStrikeGroup, ...]]:
    windows = tuple(
        (
            truth_index,
            truth_group.seconds - onset_tolerance_seconds,
            truth_group.seconds + onset_tolerance_seconds,
        )
        for truth_index, truth_group in enumerate(truth_groups)
    )
    predictions_by_truth: dict[int, list[MidiStrikeGroup]] = {}
    for predicted_index, predicted_group in enumerate(predicted_groups):
        if predicted_index in assigned_prediction_indices:
            continue
        matching_windows = [
            (abs(predicted_group.seconds - truth_groups[truth_index].seconds), truth_index)
            for truth_index, start, end in windows
            if start <= predicted_group.seconds <= end
        ]
        if not matching_windows:
            continue
        _, truth_index = min(matching_windows)
        predictions_by_truth.setdefault(truth_index, []).append(predicted_group)
    return {
        truth_index: tuple(predictions)
        for truth_index, predictions in predictions_by_truth.items()
    }


def assign_predicted_groups(
    truth_groups: tuple[MidiStrikeGroup, ...],
    *,
    predicted_groups: tuple[MidiStrikeGroup, ...],
    onset_tolerance_seconds: float,
) -> dict[int, int]:
    candidates: list[tuple[float, int, int]] = []
    for truth_index, truth_group in enumerate(truth_groups):
        for predicted_index, predicted_group in enumerate(predicted_groups):
            onset_delta = abs(predicted_group.seconds - truth_group.seconds)
            if onset_delta <= onset_tolerance_seconds:
                candidates.append((onset_delta, truth_index, predicted_index))

    assigned_truth: set[int] = set()
    assigned_predicted: set[int] = set()
    assignments: dict[int, int] = {}
    for _, truth_index, predicted_index in sorted(candidates):
        if truth_index in assigned_truth or predicted_index in assigned_predicted:
            continue
        assigned_truth.add(truth_index)
        assigned_predicted.add(predicted_index)
        assignments[truth_index] = predicted_index
    return assignments


def build_report(
    *,
    manifest: dict[str, object],
    selection_manifest_path: Path,
    predicted_midi_path: Path,
    provider_id: str,
    provider_version: str | None,
    provider_checkpoint: str | None,
    onset_tolerance_seconds: float,
    chord_window_seconds: float,
    predicted_group_count: int,
    evaluations: list[dict[str, object]],
) -> dict[str, object]:
    matched_count = sum(len(evaluation["matched_truth"]) for evaluation in evaluations)
    truth_count = sum(len(evaluation["truth_pitches"]) for evaluation in evaluations)
    predicted_count = sum(len(evaluation["predicted_pitches"]) for evaluation in evaluations)
    extra_count = sum(len(evaluation["extra_predicted"]) for evaluation in evaluations)
    unassigned_prediction_count = sum(
        len(evaluation["unassigned_predicted_groups"]) for evaluation in evaluations
    )
    onset_matched = [evaluation for evaluation in evaluations if evaluation["predicted_seconds"] is not None]
    chord_evaluations = [
        evaluation for evaluation in evaluations if len(evaluation["truth_pitches"]) > 1
    ]
    absolute_errors = [
        abs(float(evaluation["onset_error_seconds"]))
        for evaluation in onset_matched
        if evaluation["onset_error_seconds"] is not None
    ]
    dataset = manifest.get("dataset", {})
    return {
        "dataset": dataset,
        "provider": {
            "provider_id": provider_id,
            "provider_version": provider_version,
            "provider_checkpoint": provider_checkpoint,
            "predicted_midi_path": str(predicted_midi_path),
            "predicted_midi_sha256": _file_sha256(predicted_midi_path),
        },
        "benchmark": {
            "benchmark_scope": BENCHMARK_SCOPE_SELECTED_TRUTH_WINDOW_TRANSCRIPTION,
            "truth_source": "frozen_paired_midi_selection_manifest",
            "selection_manifest_path": str(selection_manifest_path),
            "selection_manifest_sha256": _file_sha256(selection_manifest_path),
            "selection_source_scope": BENCHMARK_SCOPE_PAIRED_MIDI_ORACLE_ONSET,
            "provider_owns_onsets": True,
            "uses_score": False,
            "causal": False,
            "onset_tolerance_seconds": onset_tolerance_seconds,
            "chord_window_seconds": chord_window_seconds,
            "selected_truth_group_count": len(evaluations),
            "predicted_group_count": predicted_group_count,
            "unassigned_predicted_group_count_in_selected_windows": unassigned_prediction_count,
        },
        "metrics": {
            "onset_group_recall": _ratio(len(onset_matched), len(evaluations)),
            "expected_strike_recall": _ratio(matched_count, truth_count),
            "predicted_strike_precision": _ratio(matched_count, predicted_count),
            "false_discovery_rate": _ratio(extra_count, predicted_count),
            "exact_group_match_rate": _ratio(
                sum(
                    1
                    for evaluation in evaluations
                    if set(evaluation["predicted_pitches"]) == set(evaluation["truth_pitches"])
                ),
                len(evaluations),
            ),
            "chord_complete_detection_rate": _ratio(
                sum(
                    1
                    for evaluation in chord_evaluations
                    if set(evaluation["matched_truth"]) == set(evaluation["truth_pitches"])
                ),
                len(chord_evaluations),
            ),
            "median_abs_onset_error_seconds": (
                None if not absolute_errors else round(median(absolute_errors), 6)
            ),
            "matched_truth_count": matched_count,
            "truth_strike_count": truth_count,
            "predicted_strike_count_in_selected_windows": predicted_count,
            "extra_predicted_count_in_selected_windows": extra_count,
            "chord_group_count": len(chord_evaluations),
        },
        "diagnostics": {
            "first_20_groups": evaluations[:20],
            "first_20_misses": [
                evaluation
                for evaluation in evaluations
                if evaluation["missing_truth"] or evaluation["extra_predicted"]
            ][:20],
        },
    }


def _ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(numerator / denominator, 4)


if __name__ == "__main__":
    raise SystemExit(main())
