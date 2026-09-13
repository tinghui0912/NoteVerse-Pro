"""Evaluate score-conditioned STEP cases from a frozen paired-MIDI manifest.

This benchmark asks a product question that raw AMT metrics cannot answer:
given known ExpectedStrikeTargets, would the provider evidence accept the target?

The first implementation is intentionally an offline oracle over a provider MIDI
transcript. It may have benefited from future audio during transcription, so it
must not report product false-advance metrics. It still provides useful
positive and counterfactual-negative evidence before a bounded-context provider
is available.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
from statistics import median
from typing import Literal

import numpy as np

from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    ExpectedPracticeNote,
    ExpectedPracticeStrikeTarget,
)
from app.processing.engines.practice_alignment.target_conditioned_acoustic_observation import (
    TargetConditionedPianoObserver,
)
from evaluate_public_paired_midi_dataset import (
    BENCHMARK_SCOPE_PAIRED_MIDI_ORACLE_ONSET,
    DEFAULT_SAMPLE_RATE,
    MidiStrikeGroup,
    _file_sha256,
    group_note_ons,
    load_selection_manifest,
    parse_midi_note_ons,
    read_pcm_wav,
)
from evaluate_selected_truth_window_transcription import (
    assign_predicted_groups,
    load_truth_groups_from_manifest,
)


BENCHMARK_SCOPE_SCORE_CONDITIONED_STEP_EVALUATION = "score_conditioned_step_evaluation"
EVALUATION_MODE_OFFLINE_FULL_TRANSCRIPT = "offline_full_transcript"
DEFAULT_ONSET_TOLERANCE_SECONDS = 0.08
DEFAULT_CHORD_WINDOW_SECONDS = 0.05
CaseKind = Literal[
    "positive",
    "missing_added_pitch_negative",
    "semitone_confusion_negative",
    "octave_confusion_negative",
]
EvaluationResult = Literal["MATCH", "PARTIAL", "MISMATCH", "UNCERTAIN"]


@dataclass(frozen=True)
class StepCase:
    case_id: str
    kind: CaseKind
    seconds: float
    actual_pitches: tuple[str, ...]
    expected_pitches: tuple[str, ...]
    source_group_index: int
    mutation: dict[str, object]


@dataclass(frozen=True)
class StepCaseEvaluation:
    case: StepCase
    predicted_seconds: float | None
    observed_pitches: tuple[str, ...]
    onset_error_seconds: float | None
    result: EvaluationResult
    matched_expected: tuple[str, ...]
    missing_expected: tuple[str, ...]
    extra_observed: tuple[str, ...]


def main() -> int:
    args = parse_args()
    manifest = load_selection_manifest(args.selection_manifest)
    _validate_manifest(manifest)
    truth_groups = load_truth_groups_from_manifest(manifest)
    predicted_groups = group_note_ons(
        parse_midi_note_ons(args.predicted_midi),
        chord_window_seconds=args.chord_window_seconds,
    )
    cases = generate_step_cases(truth_groups, max_cases_per_kind=args.max_cases_per_kind)
    evaluations = evaluate_step_cases(
        cases,
        predicted_groups=predicted_groups,
        onset_tolerance_seconds=args.onset_tolerance_seconds,
    )
    bounded_context_evaluations = {
        horizon_seconds: evaluate_step_cases_with_bounded_context(
            cases,
            predicted_groups=predicted_groups,
            horizon_seconds=horizon_seconds,
            onset_preroll_seconds=args.onset_tolerance_seconds,
        )
        for horizon_seconds in args.bounded_horizon_seconds
    }
    transcript_shadow_runtime_evaluations = {
        horizon_seconds: evaluate_step_cases_with_transcript_shadow_runtime(
            cases,
            predicted_groups=predicted_groups,
            horizon_seconds=horizon_seconds,
            onset_preroll_seconds=args.onset_tolerance_seconds,
        )
        for horizon_seconds in args.bounded_horizon_seconds
    }
    causal_audio_provider_evaluations = {}
    audio_path = _manifest_audio_path(manifest, base_path=args.selection_manifest.parent)
    if args.causal_audio_provider:
        if audio_path is None:
            raise ValueError("Selection manifest does not include dataset.audio_path")
        provider = _causal_audio_provider(args.causal_audio_provider)
        audio = read_pcm_wav(audio_path, sample_rate=args.sample_rate)
        causal_audio_provider_evaluations = {
            horizon_seconds: evaluate_step_cases_with_causal_audio_provider(
                cases,
                audio=audio,
                sample_rate=args.sample_rate,
                provider=provider,
                horizon_seconds=horizon_seconds,
                onset_preroll_seconds=args.onset_tolerance_seconds,
            )
            for horizon_seconds in args.bounded_horizon_seconds
        }
    report = build_report(
        manifest=manifest,
        selection_manifest_path=args.selection_manifest,
        predicted_midi_path=args.predicted_midi,
        provider_id=args.provider_id,
        provider_version=args.provider_version,
        provider_checkpoint=args.provider_checkpoint,
        onset_tolerance_seconds=args.onset_tolerance_seconds,
        chord_window_seconds=args.chord_window_seconds,
        evaluations=evaluations,
        bounded_context_evaluations=bounded_context_evaluations,
        transcript_shadow_runtime_evaluations=transcript_shadow_runtime_evaluations,
        causal_audio_provider_evaluations=causal_audio_provider_evaluations,
        causal_audio_provider_id=args.causal_audio_provider,
        causal_audio_path=audio_path if args.causal_audio_provider else None,
        sample_rate=args.sample_rate,
        predicted_group_count=len(predicted_groups),
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
    parser.add_argument("--max-cases-per-kind", type=int, default=None)
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
    parser.add_argument(
        "--bounded-horizon-seconds",
        type=float,
        action="append",
        default=[],
        help=(
            "Add bounded score-conditioned evidence metrics using provider transcript "
            "groups inside [expected_onset - onset_tolerance, expected_onset + horizon]. "
            "This still consumes an offline transcript and is not product-false-advance eligible."
        ),
    )
    parser.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE)
    parser.add_argument(
        "--causal-audio-provider",
        choices=("target-conditioned-dsp-v1",),
        default=None,
        help=(
            "Run a benchmark-only causal audio-window provider directly on the "
            "selection manifest audio. This does not consume the provider MIDI transcript."
        ),
    )
    return parser.parse_args()


def _validate_manifest(manifest: dict[str, object]) -> None:
    benchmark = manifest.get("benchmark", {})
    if not isinstance(benchmark, dict):
        raise ValueError("Selection manifest benchmark must be an object")
    if benchmark.get("benchmark_scope") != BENCHMARK_SCOPE_PAIRED_MIDI_ORACLE_ONSET:
        raise ValueError("Selection manifest must be based on paired MIDI truth")


def generate_step_cases(
    truth_groups: tuple[MidiStrikeGroup, ...],
    *,
    max_cases_per_kind: int | None = None,
) -> tuple[StepCase, ...]:
    cases: list[StepCase] = []
    counts: dict[CaseKind, int] = {
        "positive": 0,
        "missing_added_pitch_negative": 0,
        "semitone_confusion_negative": 0,
        "octave_confusion_negative": 0,
    }

    def should_add(kind: CaseKind) -> bool:
        return max_cases_per_kind is None or counts[kind] < max_cases_per_kind

    def add_case(case: StepCase) -> None:
        cases.append(case)
        counts[case.kind] += 1

    for index, group in enumerate(truth_groups):
        actual = tuple(dict.fromkeys(group.pitches))
        if not actual:
            continue

        if should_add("positive"):
            add_case(
                StepCase(
                    case_id=f"g{index:04d}:positive",
                    kind="positive",
                    seconds=group.seconds,
                    actual_pitches=actual,
                    expected_pitches=actual,
                    source_group_index=index,
                    mutation={},
                )
            )

        if should_add("missing_added_pitch_negative"):
            added_pitch = _nearest_absent_pitch(actual)
            if added_pitch is not None:
                add_case(
                    StepCase(
                        case_id=f"g{index:04d}:missing-added:{added_pitch}",
                        kind="missing_added_pitch_negative",
                        seconds=group.seconds,
                        actual_pitches=actual,
                        expected_pitches=actual + (added_pitch,),
                        source_group_index=index,
                        mutation={"added_expected_pitch": added_pitch},
                    )
                )

        if should_add("semitone_confusion_negative"):
            semitone_case = _mutated_expected_pitch(actual, semitones=1)
            if semitone_case is not None:
                original, replacement, expected = semitone_case
                add_case(
                    StepCase(
                        case_id=f"g{index:04d}:semitone:{original}->{replacement}",
                        kind="semitone_confusion_negative",
                        seconds=group.seconds,
                        actual_pitches=actual,
                        expected_pitches=expected,
                        source_group_index=index,
                        mutation={
                            "original_pitch": original,
                            "expected_pitch": replacement,
                            "interval_semitones": 1,
                        },
                    )
                )

        if should_add("octave_confusion_negative"):
            octave_case = _mutated_expected_pitch(actual, semitones=12)
            if octave_case is not None:
                original, replacement, expected = octave_case
                add_case(
                    StepCase(
                        case_id=f"g{index:04d}:octave:{original}->{replacement}",
                        kind="octave_confusion_negative",
                        seconds=group.seconds,
                        actual_pitches=actual,
                        expected_pitches=expected,
                        source_group_index=index,
                        mutation={
                            "original_pitch": original,
                            "expected_pitch": replacement,
                            "interval_semitones": 12,
                        },
                    )
                )

    return tuple(cases)


def evaluate_step_cases(
    cases: tuple[StepCase, ...],
    *,
    predicted_groups: tuple[MidiStrikeGroup, ...],
    onset_tolerance_seconds: float,
) -> tuple[StepCaseEvaluation, ...]:
    source_groups = _source_truth_groups(cases)
    source_assignments = assign_predicted_groups(
        source_groups,
        predicted_groups=predicted_groups,
        onset_tolerance_seconds=onset_tolerance_seconds,
    )
    predicted_group_by_source_index = {
        source_groups[source_index].source_index: predicted_groups[prediction_index]
        for source_index, prediction_index in source_assignments.items()
    }

    evaluations: list[StepCaseEvaluation] = []
    for case in cases:
        predicted_group = predicted_group_by_source_index.get(case.source_group_index)
        observed = tuple(() if predicted_group is None else dict.fromkeys(predicted_group.pitches))
        result, matched, missing, extra = _evaluate_expected(case.expected_pitches, observed)
        evaluations.append(
            StepCaseEvaluation(
                case=case,
                predicted_seconds=None if predicted_group is None else predicted_group.seconds,
                observed_pitches=observed,
                onset_error_seconds=(
                    None
                    if predicted_group is None
                    else round(predicted_group.seconds - case.seconds, 6)
                ),
                result=result,
                matched_expected=matched,
                missing_expected=missing,
                extra_observed=extra,
            )
        )
    return tuple(evaluations)


def evaluate_step_cases_with_bounded_context(
    cases: tuple[StepCase, ...],
    *,
    predicted_groups: tuple[MidiStrikeGroup, ...],
    horizon_seconds: float,
    onset_preroll_seconds: float,
) -> tuple[StepCaseEvaluation, ...]:
    if horizon_seconds < 0:
        raise ValueError("horizon_seconds must be non-negative")
    if onset_preroll_seconds < 0:
        raise ValueError("onset_preroll_seconds must be non-negative")

    evaluations: list[StepCaseEvaluation] = []
    for case in cases:
        window_start = case.seconds - onset_preroll_seconds
        window_end = case.seconds + horizon_seconds
        context_groups = tuple(
            group for group in predicted_groups if window_start <= group.seconds <= window_end
        )
        first_group = context_groups[0] if context_groups else None
        observed = tuple(() if first_group is None else dict.fromkeys(first_group.pitches))
        result, matched, missing, extra = _evaluate_expected(case.expected_pitches, observed)
        evaluations.append(
            StepCaseEvaluation(
                case=case,
                predicted_seconds=None if first_group is None else first_group.seconds,
                observed_pitches=observed,
                onset_error_seconds=(
                    None if first_group is None else round(first_group.seconds - case.seconds, 6)
                ),
                result=result,
                matched_expected=matched,
                missing_expected=missing,
                extra_observed=extra,
            )
        )
    return tuple(evaluations)


def evaluate_step_cases_with_transcript_shadow_runtime(
    cases: tuple[StepCase, ...],
    *,
    predicted_groups: tuple[MidiStrikeGroup, ...],
    horizon_seconds: float,
    onset_preroll_seconds: float,
) -> tuple[StepCaseEvaluation, ...]:
    if horizon_seconds < 0:
        raise ValueError("horizon_seconds must be non-negative")
    if onset_preroll_seconds < 0:
        raise ValueError("onset_preroll_seconds must be non-negative")

    evaluations: list[StepCaseEvaluation] = []
    for case in cases:
        window_start = case.seconds - onset_preroll_seconds
        window_end = case.seconds + horizon_seconds
        context_groups = tuple(
            group for group in predicted_groups if window_start <= group.seconds <= window_end
        )
        accepted_evaluation: StepCaseEvaluation | None = None
        last_evaluation: StepCaseEvaluation | None = None
        for group in context_groups:
            observed = tuple(dict.fromkeys(group.pitches))
            result, matched, missing, extra = _evaluate_expected(case.expected_pitches, observed)
            current = StepCaseEvaluation(
                case=case,
                predicted_seconds=group.seconds,
                observed_pitches=observed,
                onset_error_seconds=round(group.seconds - case.seconds, 6),
                result=result,
                matched_expected=matched,
                missing_expected=missing,
                extra_observed=extra,
            )
            last_evaluation = current
            if result == "MATCH":
                accepted_evaluation = current
                break
        if accepted_evaluation is not None:
            evaluations.append(accepted_evaluation)
        elif last_evaluation is not None:
            evaluations.append(last_evaluation)
        else:
            result, matched, missing, extra = _evaluate_expected(case.expected_pitches, ())
            evaluations.append(
                StepCaseEvaluation(
                    case=case,
                    predicted_seconds=None,
                    observed_pitches=(),
                    onset_error_seconds=None,
                    result=result,
                    matched_expected=matched,
                    missing_expected=missing,
                    extra_observed=extra,
                )
            )
    return tuple(evaluations)


def evaluate_step_cases_with_causal_audio_provider(
    cases: tuple[StepCase, ...],
    *,
    audio,
    sample_rate: int,
    provider: TargetConditionedPianoObserver,
    horizon_seconds: float,
    onset_preroll_seconds: float,
) -> tuple[StepCaseEvaluation, ...]:
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")
    if horizon_seconds < 0:
        raise ValueError("horizon_seconds must be non-negative")
    if onset_preroll_seconds < 0:
        raise ValueError("onset_preroll_seconds must be non-negative")

    audio_array = np.asarray(audio, dtype=np.float32)
    evaluations: list[StepCaseEvaluation] = []
    for case in cases:
        window_start_seconds = max(0.0, case.seconds - onset_preroll_seconds)
        window_end_seconds = min(audio_array.size / sample_rate, case.seconds + horizon_seconds)
        start_sample = int(round(window_start_seconds * sample_rate))
        end_sample = int(round(window_end_seconds * sample_rate))
        window = audio_array[start_sample:end_sample]
        expected_group = _expected_group_from_case(case)
        observation = provider.observe_expected_group(
            window,
            expected_group=expected_group,
            sample_rate=sample_rate,
            np_module=np,
            onset_beat=None,
            window_start_seconds=round(window_start_seconds, 6),
            window_end_seconds=round(window_end_seconds, 6),
        )
        observed = tuple(dict.fromkeys(observation.observed_pitches))
        result, matched, missing, extra = _evaluate_expected(case.expected_pitches, observed)
        evaluations.append(
            StepCaseEvaluation(
                case=case,
                predicted_seconds=None,
                observed_pitches=observed,
                onset_error_seconds=None,
                result=result,
                matched_expected=matched,
                missing_expected=missing,
                extra_observed=extra,
            )
        )
    return tuple(evaluations)


@dataclass(frozen=True)
class _SourceTruthGroup(MidiStrikeGroup):
    source_index: int


def _source_truth_groups(cases: tuple[StepCase, ...]) -> tuple[_SourceTruthGroup, ...]:
    source_cases: dict[int, StepCase] = {}
    for case in cases:
        source_cases.setdefault(case.source_group_index, case)
    return tuple(
        _SourceTruthGroup(
            seconds=case.seconds,
            pitches=case.actual_pitches,
            midi_notes=tuple(_pitch_to_midi_note(pitch) for pitch in case.actual_pitches),
            source_index=source_index,
        )
        for source_index, case in sorted(source_cases.items())
    )


def _expected_group_from_case(case: StepCase) -> ExpectedPracticeGroup:
    expected_notes = tuple(
        ExpectedPracticeNote(
            expected_note_id=f"{case.case_id}:note:{index}",
            event_id=case.case_id,
            pitch=pitch,
            render_note_id=f"{case.case_id}:render:{index}",
            measure_numbers=(),
        )
        for index, pitch in enumerate(case.expected_pitches, start=1)
    )
    strike_targets = tuple(
        ExpectedPracticeStrikeTarget(
            strike_id=f"{case.case_id}:strike:{pitch}",
            pitch=pitch,
            expected_notes=tuple(note for note in expected_notes if note.pitch == pitch),
            event_ids=(case.case_id,),
            render_note_ids=tuple(
                note.render_note_id for note in expected_notes if note.pitch == pitch
            ),
            measure_numbers=(),
        )
        for pitch in dict.fromkeys(case.expected_pitches)
    )
    return ExpectedPracticeGroup(
        group_id=case.case_id,
        onset_beat=0.0,
        event_ids=(case.case_id,),
        expected_notes=expected_notes,
        strike_targets=strike_targets,
        render_note_ids=tuple(note.render_note_id for note in expected_notes),
        pitches=tuple(dict.fromkeys(case.expected_pitches)),
        measure_numbers=(),
        staff_ids=(),
        voice_ids=(),
    )


def _manifest_audio_path(manifest: dict[str, object], *, base_path: Path) -> Path | None:
    dataset = manifest.get("dataset", {})
    if not isinstance(dataset, dict):
        return None
    audio_path = dataset.get("audio_path")
    if not isinstance(audio_path, str) or not audio_path:
        return None
    path = Path(audio_path)
    if path.is_absolute():
        return path
    direct = Path.cwd() / path
    if direct.exists():
        return direct
    relative_to_manifest = base_path / path
    if relative_to_manifest.exists():
        return relative_to_manifest
    return path


def _causal_audio_provider(provider_id: str) -> TargetConditionedPianoObserver:
    if provider_id == "target-conditioned-dsp-v1":
        return TargetConditionedPianoObserver()
    raise ValueError(f"Unsupported causal audio provider: {provider_id}")


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
    evaluations: tuple[StepCaseEvaluation, ...],
    bounded_context_evaluations: dict[float, tuple[StepCaseEvaluation, ...]] | None = None,
    transcript_shadow_runtime_evaluations: (
        dict[float, tuple[StepCaseEvaluation, ...]] | None
    ) = None,
    causal_audio_provider_evaluations: (
        dict[float, tuple[StepCaseEvaluation, ...]] | None
    ) = None,
    causal_audio_provider_id: str | None = None,
    causal_audio_path: Path | None = None,
    sample_rate: int | None = None,
) -> dict[str, object]:
    positives = tuple(evaluation for evaluation in evaluations if evaluation.case.kind == "positive")
    negatives = tuple(evaluation for evaluation in evaluations if evaluation.case.kind != "positive")
    absolute_errors = [
        abs(evaluation.onset_error_seconds)
        for evaluation in positives
        if evaluation.onset_error_seconds is not None
    ]
    return {
        "dataset": manifest.get("dataset", {}),
        "provider": {
            "provider_id": provider_id,
            "provider_version": provider_version,
            "provider_checkpoint": provider_checkpoint,
            "predicted_midi_path": str(predicted_midi_path),
            "predicted_midi_sha256": _file_sha256(predicted_midi_path),
        },
        "benchmark": {
            "benchmark_scope": BENCHMARK_SCOPE_SCORE_CONDITIONED_STEP_EVALUATION,
            "evaluation_mode": EVALUATION_MODE_OFFLINE_FULL_TRANSCRIPT,
            "truth_source": "frozen_paired_midi_selection_manifest",
            "selection_manifest_path": str(selection_manifest_path),
            "selection_manifest_sha256": _file_sha256(selection_manifest_path),
            "provider_owns_onsets": True,
            "uses_score": True,
            "causal": False,
            "uses_future_context": True,
            "product_false_advance_eligible": False,
            "onset_tolerance_seconds": onset_tolerance_seconds,
            "chord_window_seconds": chord_window_seconds,
            "selected_truth_group_count": len(manifest.get("groups", ())),
            "case_count": len(evaluations),
            "predicted_group_count": predicted_group_count,
            "case_generation": {
                "positive": "expected_pitches == actual paired-MIDI strike pitches",
                "missing_added_pitch_negative": (
                    "expected adds one absent pitch to the actual strike pitches"
                ),
                "semitone_confusion_negative": (
                    "expected replaces one actual pitch by a one-semitone neighbor"
                ),
                "octave_confusion_negative": (
                    "expected replaces one actual pitch by an octave neighbor"
                ),
            },
        },
        "metrics": {
            "single_pass_correct_acceptance_rate": _match_rate(positives),
            "correct_input_acceptance_rate": _match_rate(positives),
            "false_completion_rate": _match_rate(negatives),
            "missing_added_pitch_false_match_rate": _match_rate(
                _by_kind(evaluations, "missing_added_pitch_negative")
            ),
            "semitone_confusion_false_match_rate": _match_rate(
                _by_kind(evaluations, "semitone_confusion_negative")
            ),
            "octave_confusion_false_match_rate": _match_rate(
                _by_kind(evaluations, "octave_confusion_negative")
            ),
            "product_false_advance_rate": None,
            "median_abs_onset_error_seconds_for_positive_matches": (
                None if not absolute_errors else round(median(absolute_errors), 6)
            ),
        },
        "metrics_by_case_kind": {
            kind: _case_kind_metrics(_by_kind(evaluations, kind))
            for kind in (
                "positive",
                "missing_added_pitch_negative",
                "semitone_confusion_negative",
                "octave_confusion_negative",
            )
        },
        "diagnostics": {
            "first_20_cases": [_evaluation_json(evaluation) for evaluation in evaluations[:20]],
            "first_20_false_matches": [
                _evaluation_json(evaluation)
                for evaluation in negatives
                if evaluation.result == "MATCH"
            ][:20],
        },
        "bounded_context_metrics": {
            _horizon_key(horizon_seconds): _bounded_context_report(
                horizon_seconds=horizon_seconds,
                evaluations=horizon_evaluations,
            )
            for horizon_seconds, horizon_evaluations in sorted(
                (bounded_context_evaluations or {}).items()
            )
        },
        "transcript_shadow_runtime_metrics": {
            _horizon_key(horizon_seconds): _transcript_shadow_runtime_report(
                horizon_seconds=horizon_seconds,
                evaluations=horizon_evaluations,
            )
            for horizon_seconds, horizon_evaluations in sorted(
                (transcript_shadow_runtime_evaluations or {}).items()
            )
        },
        "causal_audio_provider_metrics": {
            _horizon_key(horizon_seconds): _causal_audio_provider_report(
                horizon_seconds=horizon_seconds,
                evaluations=horizon_evaluations,
                provider_id=causal_audio_provider_id,
                audio_path=causal_audio_path,
                sample_rate=sample_rate,
            )
            for horizon_seconds, horizon_evaluations in sorted(
                (causal_audio_provider_evaluations or {}).items()
            )
        },
    }


def _evaluate_expected(
    expected_pitches: tuple[str, ...],
    observed_pitches: tuple[str, ...],
) -> tuple[EvaluationResult, tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    expected = tuple(dict.fromkeys(expected_pitches))
    observed = tuple(dict.fromkeys(observed_pitches))
    if not observed:
        return "UNCERTAIN", (), expected, ()

    observed_set = set(observed)
    expected_set = set(expected)
    matched = tuple(pitch for pitch in expected if pitch in observed_set)
    missing = tuple(pitch for pitch in expected if pitch not in observed_set)
    extra = tuple(pitch for pitch in observed if pitch not in expected_set)
    if not missing and not extra:
        result: EvaluationResult = "MATCH"
    elif matched and not extra:
        result = "PARTIAL"
    else:
        result = "MISMATCH"
    return result, matched, missing, extra


def _nearest_absent_pitch(pitches: tuple[str, ...]) -> str | None:
    midi_notes = {_pitch_to_midi_note(pitch) for pitch in pitches}
    anchor = sorted(midi_notes)[len(midi_notes) // 2]
    for offset in (7, 5, 4, 3, 2, 1, -1, -2, -3, -4, -5, -7, 12, -12):
        candidate = anchor + offset
        if 21 <= candidate <= 108 and candidate not in midi_notes:
            return _midi_note_name(candidate)
    return None


def _mutated_expected_pitch(
    pitches: tuple[str, ...],
    *,
    semitones: int,
) -> tuple[str, str, tuple[str, ...]] | None:
    midi_notes = tuple(_pitch_to_midi_note(pitch) for pitch in pitches)
    midi_note_set = set(midi_notes)
    for index, note in enumerate(midi_notes):
        for direction in (1, -1):
            candidate = note + direction * semitones
            if 21 <= candidate <= 108 and candidate not in midi_note_set:
                replacement = _midi_note_name(candidate)
                expected = tuple(
                    replacement if item_index == index else pitch
                    for item_index, pitch in enumerate(pitches)
                )
                return pitches[index], replacement, expected
    return None


def _pitch_to_midi_note(pitch: str) -> int:
    if len(pitch) < 2:
        raise ValueError(f"Invalid pitch: {pitch}")
    if pitch[1:2] == "#":
        pitch_class = pitch[:2]
        octave_text = pitch[2:]
    else:
        pitch_class = pitch[:1]
        octave_text = pitch[1:]
    pitch_classes = {
        "C": 0,
        "C#": 1,
        "D": 2,
        "D#": 3,
        "E": 4,
        "F": 5,
        "F#": 6,
        "G": 7,
        "G#": 8,
        "A": 9,
        "A#": 10,
        "B": 11,
    }
    if pitch_class not in pitch_classes:
        raise ValueError(f"Invalid pitch: {pitch}")
    return (int(octave_text) + 1) * 12 + pitch_classes[pitch_class]


def _midi_note_name(note_number: int) -> str:
    names = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    return f"{names[note_number % 12]}{note_number // 12 - 1}"


def _by_kind(
    evaluations: tuple[StepCaseEvaluation, ...],
    kind: CaseKind,
) -> tuple[StepCaseEvaluation, ...]:
    return tuple(evaluation for evaluation in evaluations if evaluation.case.kind == kind)


def _match_rate(evaluations: tuple[StepCaseEvaluation, ...]) -> float | None:
    if not evaluations:
        return None
    return round(
        sum(1 for evaluation in evaluations if evaluation.result == "MATCH") / len(evaluations),
        4,
    )


def _case_kind_metrics(evaluations: tuple[StepCaseEvaluation, ...]) -> dict[str, object]:
    if not evaluations:
        return {
            "case_count": 0,
            "match_rate": None,
            "partial_rate": None,
            "mismatch_rate": None,
            "uncertain_rate": None,
        }
    return {
        "case_count": len(evaluations),
        "match_rate": _match_rate(evaluations),
        "partial_rate": _result_rate(evaluations, "PARTIAL"),
        "mismatch_rate": _result_rate(evaluations, "MISMATCH"),
        "uncertain_rate": _result_rate(evaluations, "UNCERTAIN"),
    }


def _bounded_context_report(
    *,
    horizon_seconds: float,
    evaluations: tuple[StepCaseEvaluation, ...],
) -> dict[str, object]:
    positives = tuple(evaluation for evaluation in evaluations if evaluation.case.kind == "positive")
    negatives = tuple(evaluation for evaluation in evaluations if evaluation.case.kind != "positive")
    return {
        "horizon_seconds": horizon_seconds,
        "evaluation_mode": "bounded_offline_transcript_context",
        "causal": False,
        "uses_future_context": True,
        "product_false_advance_eligible": False,
        "product_false_advance_rate": None,
        "bounded_correct_acceptance_rate": _match_rate(positives),
        "bounded_false_completion_rate": _match_rate(negatives),
        "metrics_by_case_kind": {
            kind: _case_kind_metrics(_by_kind(evaluations, kind))
            for kind in (
                "positive",
                "missing_added_pitch_negative",
                "semitone_confusion_negative",
                "octave_confusion_negative",
            )
        },
        "diagnostics": {
            "first_20_false_matches": [
                _evaluation_json(evaluation)
                for evaluation in negatives
                if evaluation.result == "MATCH"
            ][:20],
        },
    }


def _transcript_shadow_runtime_report(
    *,
    horizon_seconds: float,
    evaluations: tuple[StepCaseEvaluation, ...],
) -> dict[str, object]:
    positives = tuple(evaluation for evaluation in evaluations if evaluation.case.kind == "positive")
    negatives = tuple(evaluation for evaluation in evaluations if evaluation.case.kind != "positive")
    return {
        "horizon_seconds": horizon_seconds,
        "evaluation_mode": "transcript_shadow_runtime",
        "causal_runtime_loop": True,
        "causal_provider": False,
        "uses_future_context": True,
        "product_false_advance_eligible": False,
        "product_false_advance_rate": None,
        "shadow_correct_acceptance_rate": _match_rate(positives),
        "shadow_false_completion_rate": _match_rate(negatives),
        "metrics_by_case_kind": {
            kind: _case_kind_metrics(_by_kind(evaluations, kind))
            for kind in (
                "positive",
                "missing_added_pitch_negative",
                "semitone_confusion_negative",
                "octave_confusion_negative",
            )
        },
        "diagnostics": {
            "first_20_false_matches": [
                _evaluation_json(evaluation)
                for evaluation in negatives
                if evaluation.result == "MATCH"
            ][:20],
        },
    }


def _causal_audio_provider_report(
    *,
    horizon_seconds: float,
    evaluations: tuple[StepCaseEvaluation, ...],
    provider_id: str | None,
    audio_path: Path | None,
    sample_rate: int | None,
) -> dict[str, object]:
    positives = tuple(evaluation for evaluation in evaluations if evaluation.case.kind == "positive")
    negatives = tuple(evaluation for evaluation in evaluations if evaluation.case.kind != "positive")
    return {
        "horizon_seconds": horizon_seconds,
        "evaluation_mode": "causal_audio_window_provider",
        "provider_id": provider_id,
        "audio_path": None if audio_path is None else str(audio_path),
        "sample_rate_hz": sample_rate,
        "causal_provider": True,
        "causal_runtime_loop": False,
        "uses_future_context": False,
        "product_false_advance_eligible": False,
        "product_false_advance_rate": None,
        "correct_acceptance_rate": _match_rate(positives),
        "false_completion_rate": _match_rate(negatives),
        "metrics_by_case_kind": {
            kind: _case_kind_metrics(_by_kind(evaluations, kind))
            for kind in (
                "positive",
                "missing_added_pitch_negative",
                "semitone_confusion_negative",
                "octave_confusion_negative",
            )
        },
        "diagnostics": {
            "first_20_false_matches": [
                _evaluation_json(evaluation)
                for evaluation in negatives
                if evaluation.result == "MATCH"
            ][:20],
        },
    }


def _horizon_key(horizon_seconds: float) -> str:
    return f"{int(round(horizon_seconds * 1000))}ms"


def _result_rate(evaluations: tuple[StepCaseEvaluation, ...], result: EvaluationResult) -> float:
    return round(sum(1 for evaluation in evaluations if evaluation.result == result) / len(evaluations), 4)


def _evaluation_json(evaluation: StepCaseEvaluation) -> dict[str, object]:
    return {
        "case_id": evaluation.case.case_id,
        "case_kind": evaluation.case.kind,
        "seconds": round(evaluation.case.seconds, 6),
        "actual_pitches": evaluation.case.actual_pitches,
        "expected_pitches": evaluation.case.expected_pitches,
        "predicted_seconds": (
            None if evaluation.predicted_seconds is None else round(evaluation.predicted_seconds, 6)
        ),
        "observed_pitches": evaluation.observed_pitches,
        "onset_error_seconds": evaluation.onset_error_seconds,
        "result": evaluation.result,
        "matched_expected": evaluation.matched_expected,
        "missing_expected": evaluation.missing_expected,
        "extra_observed": evaluation.extra_observed,
        "mutation": evaluation.case.mutation,
    }


if __name__ == "__main__":
    raise SystemExit(main())
