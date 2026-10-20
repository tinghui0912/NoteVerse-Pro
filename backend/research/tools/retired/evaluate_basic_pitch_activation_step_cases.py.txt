"""Evaluate Basic Pitch raw activations against score-conditioned STEP cases.

This benchmark intentionally bypasses Basic Pitch MIDI decoding. Basic Pitch is
used only as an acoustic evidence frontend: raw onset/note activations are
projected onto ExpectedPracticeStrikeTarget pitches, and NoteVerse keeps
ownership of MATCH / PARTIAL / MISMATCH semantics.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import wave

import numpy as np

from evaluate_public_paired_midi_dataset import (
    DEFAULT_SAMPLE_RATE,
    MidiStrikeGroup,
    load_selection_manifest,
    read_pcm_wav,
)
from evaluate_score_conditioned_step_cases import (
    StepCase,
    StepCaseEvaluation,
    _by_kind,
    _case_kind_metrics,
    _evaluate_expected,
    _evaluation_json,
    _file_sha256,
    _horizon_key,
    _manifest_audio_path,
    _match_rate,
    _midi_note_name,
    _pitch_to_midi_note,
    generate_step_cases,
    load_truth_groups_from_manifest,
)
from evaluate_transkun_bounded_clips import (
    _is_contaminated_negative_match,
    _parse_source_group_indices,
    _selected_source_indices,
)


BENCHMARK_SCOPE_BASIC_PITCH_RAW_ACTIVATION = "basic_pitch_raw_activation_provider"
DEFAULT_PRE_ROLL_SECONDS = 0.25
DEFAULT_ONSET_ACTIVATION_THRESHOLD = 0.5
DEFAULT_NOTE_ACTIVATION_THRESHOLD = 0.3
MIDI_OFFSET = 21


def main() -> int:
    args = parse_args()
    manifest = load_selection_manifest(args.selection_manifest)
    truth_groups = load_truth_groups_from_manifest(manifest)
    cases = generate_step_cases(truth_groups, max_cases_per_kind=args.max_cases_per_kind)
    requested_source_indices = _parse_source_group_indices(args.source_group_indices)
    audio_path = _manifest_audio_path(manifest, base_path=args.selection_manifest.parent)
    if audio_path is None:
        raise ValueError("Selection manifest does not include dataset.audio_path")
    audio = read_pcm_wav(audio_path, sample_rate=args.sample_rate)

    provider = BasicPitchActivationProvider(model_path=args.model_path)
    reports_by_horizon: dict[float, dict[str, object]] = {}
    for horizon_seconds in args.horizon_seconds:
        source_indices = _selected_source_indices(
            cases,
            truth_groups=truth_groups,
            horizon_seconds=horizon_seconds,
            requested_source_indices=requested_source_indices,
            source_group_offset=args.source_group_offset,
            max_source_groups=args.max_source_groups,
            require_isolated_gesture=args.require_no_subsequent_strike,
        )
        activation_predictions = collect_activation_predictions(
            audio=audio,
            sample_rate=args.sample_rate,
            cases=cases,
            source_indices=source_indices,
            horizon_seconds=horizon_seconds,
            pre_roll_seconds=args.pre_roll_seconds,
            work_dir=args.work_dir,
            provider=provider,
            onset_threshold=args.onset_activation_threshold,
            note_threshold=args.note_activation_threshold,
            unexpected_pitch_policy=args.unexpected_pitch_policy,
        )
        evaluations = evaluate_cases_from_activation_predictions(
            cases,
            activation_predictions=activation_predictions,
        )
        reports_by_horizon[horizon_seconds] = _horizon_report(
            horizon_seconds=horizon_seconds,
            evaluations=evaluations,
            activation_predictions=activation_predictions,
            truth_groups=truth_groups,
        )

    report = {
        "dataset": manifest.get("dataset", {}),
        "provider": {
            "provider_id": "basic_pitch_raw_activation",
            "provider_version": args.provider_version,
            "model_path": str(provider.model_path),
            "model_sha256": _file_sha256(provider.model_path),
        },
        "benchmark": {
            "benchmark_scope": BENCHMARK_SCOPE_BASIC_PITCH_RAW_ACTIVATION,
            "truth_source": "frozen_paired_midi_selection_manifest",
            "selection_manifest_path": str(args.selection_manifest),
            "selection_manifest_sha256": _file_sha256(args.selection_manifest),
            "audio_path": str(audio_path),
            "audio_sha256": _file_sha256(audio_path),
            "onset_source": "paired_midi",
            "window_anchor_source": "paired_midi",
            "bounded_context": True,
            "future_beyond_decision_time": False,
            "streaming_causal": False,
            "causal_attempt_detection": False,
            "causal_runtime_loop": False,
            "source_selection_mode": (
                "no_subsequent_strike_within_horizon"
                if args.require_no_subsequent_strike
                else "explicit_source_group_indices"
                if requested_source_indices is not None
                else "manifest_order"
            ),
            "requested_source_group_indices": requested_source_indices,
            "product_false_advance_eligible": False,
            "product_false_advance_rate": None,
            "sample_rate_hz": args.sample_rate,
            "pre_roll_seconds": args.pre_roll_seconds,
            "onset_activation_threshold": args.onset_activation_threshold,
            "note_activation_threshold": args.note_activation_threshold,
            "unexpected_pitch_policy": args.unexpected_pitch_policy,
            "case_count": sum(len(report["evaluations"]) for report in reports_by_horizon.values()),
        },
        "horizons": {
            _horizon_key(horizon_seconds): report
            for horizon_seconds, report in sorted(reports_by_horizon.items())
        },
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE)
    parser.add_argument("--pre-roll-seconds", type=float, default=DEFAULT_PRE_ROLL_SECONDS)
    parser.add_argument("--horizon-seconds", type=float, action="append", required=True)
    parser.add_argument("--source-group-offset", type=int, default=0)
    parser.add_argument("--source-group-indices", default=None)
    parser.add_argument("--max-source-groups", type=int, default=12)
    parser.add_argument("--require-no-subsequent-strike", action="store_true")
    parser.add_argument("--max-cases-per-kind", type=int, default=None)
    parser.add_argument("--model-path", type=Path, default=None)
    parser.add_argument("--provider-version", default="0.4.0-onnx-raw-activation")
    parser.add_argument(
        "--onset-activation-threshold",
        type=float,
        default=DEFAULT_ONSET_ACTIVATION_THRESHOLD,
    )
    parser.add_argument(
        "--note-activation-threshold",
        type=float,
        default=DEFAULT_NOTE_ACTIVATION_THRESHOLD,
    )
    parser.add_argument(
        "--unexpected-pitch-policy",
        choices=("expected_only", "all_activated"),
        default="expected_only",
        help=(
            "expected_only records non-target activations as diagnostics but does not "
            "treat them as observed pitches for MATCH/PARTIAL/MISMATCH. all_activated "
            "uses every activated pitch as observed and is useful only for extra-note "
            "diagnostics."
        ),
    )
    return parser.parse_args()


class BasicPitchActivationProvider:
    def __init__(self, *, model_path: Path | None = None) -> None:
        from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
        from basic_pitch.inference import Model, run_inference

        self.model_path = (
            Path(build_icassp_2022_model_path(FilenameSuffix.onnx))
            if model_path is None
            else model_path
        )
        self._model = Model(self.model_path)
        self._run_inference = run_inference

    def predict(self, clip_path: Path) -> dict[str, np.ndarray]:
        return self._run_inference(clip_path, self._model)


def collect_activation_predictions(
    *,
    audio: np.ndarray,
    sample_rate: int,
    cases: tuple[StepCase, ...],
    source_indices: tuple[int, ...],
    horizon_seconds: float,
    pre_roll_seconds: float,
    work_dir: Path,
    provider: BasicPitchActivationProvider,
    onset_threshold: float,
    note_threshold: float,
    unexpected_pitch_policy: str,
) -> dict[int, "ActivationPrediction"]:
    source_case_by_index = _source_case_by_index(cases)
    predictions: dict[int, ActivationPrediction] = {}
    for source_index in source_indices:
        case = source_case_by_index[source_index]
        clip_start_seconds = max(0.0, case.seconds - pre_roll_seconds)
        clip_end_seconds = min(audio.size / sample_rate, case.seconds + horizon_seconds)
        clip_audio = _slice_audio(
            audio,
            sample_rate=sample_rate,
            start_seconds=clip_start_seconds,
            end_seconds=clip_end_seconds,
        )
        clip_path = (
            work_dir
            / "clips"
            / (
                f"g{source_index:04d}"
                f"_pre{_horizon_key(pre_roll_seconds)}"
                f"_h{_horizon_key(horizon_seconds)}.wav"
            )
        )
        _write_pcm16_wav(clip_path, clip_audio, sample_rate=sample_rate)
        raw_output = provider.predict(clip_path)
        predictions[source_index] = activation_prediction_from_output(
            raw_output,
            expected_pitches=_all_case_expected_pitches(
                cases,
                source_group_index=source_index,
            ),
            clip_start_seconds=clip_start_seconds,
            decision_start_seconds=case.seconds,
            decision_end_seconds=case.seconds + horizon_seconds,
            onset_threshold=onset_threshold,
            note_threshold=note_threshold,
            unexpected_pitch_policy=unexpected_pitch_policy,
        )
    return predictions


class ActivationPrediction(dict):
    pass


def activation_prediction_from_output(
    raw_output: dict[str, np.ndarray],
    *,
    expected_pitches: tuple[str, ...],
    clip_start_seconds: float,
    decision_start_seconds: float,
    decision_end_seconds: float,
    onset_threshold: float,
    note_threshold: float,
    unexpected_pitch_policy: str = "expected_only",
) -> ActivationPrediction:
    from basic_pitch.note_creation import model_frames_to_time

    onsets = raw_output["onset"]
    notes = raw_output["note"]
    frame_times = model_frames_to_time(onsets.shape[0]) + clip_start_seconds
    frame_mask = (frame_times >= decision_start_seconds) & (frame_times <= decision_end_seconds)
    if not np.any(frame_mask):
        frame_mask = np.ones_like(frame_times, dtype=bool)
    expected_evidence: dict[str, dict[str, float | bool]] = {}
    observed_pitches: list[str] = []
    for pitch in expected_pitches:
        midi_note = _pitch_to_midi_note(pitch)
        pitch_index = midi_note - MIDI_OFFSET
        if pitch_index < 0 or pitch_index >= onsets.shape[1]:
            continue
        onset_max = float(np.max(onsets[frame_mask, pitch_index]))
        note_max = float(np.max(notes[frame_mask, pitch_index]))
        accepted = onset_max >= onset_threshold and note_max >= note_threshold
        expected_evidence[pitch] = {
            "onset_activation": round(onset_max, 6),
            "note_activation": round(note_max, 6),
            "accepted": accepted,
        }
        if accepted and pitch not in observed_pitches:
            observed_pitches.append(pitch)
    unexpected_evidence: dict[str, dict[str, float]] = {}
    expected_set = set(expected_pitches)
    for pitch_index in range(onsets.shape[1]):
        midi_note = MIDI_OFFSET + pitch_index
        pitch = _midi_note_name(midi_note)
        if pitch in expected_set:
            continue
        onset_max = float(np.max(onsets[frame_mask, pitch_index]))
        note_max = float(np.max(notes[frame_mask, pitch_index]))
        if onset_max >= onset_threshold and note_max >= note_threshold:
            unexpected_evidence[pitch] = {
                "onset_activation": round(onset_max, 6),
                "note_activation": round(note_max, 6),
            }
            if unexpected_pitch_policy == "all_activated":
                observed_pitches.append(pitch)
    return ActivationPrediction(
        expected_evidence=expected_evidence,
        unexpected_evidence=unexpected_evidence,
        observed_pitches=tuple(dict.fromkeys(observed_pitches)),
    )


def evaluate_cases_from_activation_predictions(
    cases: tuple[StepCase, ...],
    *,
    activation_predictions: dict[int, ActivationPrediction],
) -> tuple[StepCaseEvaluation, ...]:
    evaluations: list[StepCaseEvaluation] = []
    for case in cases:
        prediction = activation_predictions.get(case.source_group_index)
        if prediction is None:
            continue
        observed = tuple(
            pitch
            for pitch in prediction["observed_pitches"]
            if pitch in set(case.expected_pitches) or pitch not in set(case.actual_pitches)
        )
        result, matched, missing, extra = _evaluate_expected(case.expected_pitches, observed)
        evaluations.append(
            StepCaseEvaluation(
                case=case,
                predicted_seconds=case.seconds,
                observed_pitches=observed,
                onset_error_seconds=0.0 if observed else None,
                result=result,
                matched_expected=matched,
                missing_expected=missing,
                extra_observed=extra,
            )
        )
    return tuple(evaluations)


def _horizon_report(
    *,
    horizon_seconds: float,
    evaluations: tuple[StepCaseEvaluation, ...],
    activation_predictions: dict[int, ActivationPrediction],
    truth_groups: tuple[MidiStrikeGroup, ...],
) -> dict[str, object]:
    positives = tuple(evaluation for evaluation in evaluations if evaluation.case.kind == "positive")
    negatives = tuple(evaluation for evaluation in evaluations if evaluation.case.kind != "positive")
    contaminated_negatives = tuple(
        evaluation
        for evaluation in negatives
        if _is_contaminated_negative_match(
            evaluation,
            truth_groups=truth_groups,
            horizon_seconds=horizon_seconds,
        )
    )
    uncontaminated_negatives = tuple(
        evaluation for evaluation in negatives if evaluation not in contaminated_negatives
    )
    return {
        "horizon_seconds": horizon_seconds,
        "selected_source_group_count": len(activation_predictions),
        "source_group_indices": tuple(sorted(activation_predictions)),
        "correct_acceptance_rate": _match_rate(positives),
        "false_completion_rate": _match_rate(negatives),
        "false_completion_rate_excluding_contaminated_negatives": _match_rate(
            uncontaminated_negatives
        ),
        "contaminated_negative_false_match_count": sum(
            1 for evaluation in contaminated_negatives if evaluation.result == "MATCH"
        ),
        "missing_added_pitch_false_match_rate": _match_rate(
            _by_kind(evaluations, "missing_added_pitch_negative")
        ),
        "semitone_confusion_false_match_rate": _match_rate(
            _by_kind(evaluations, "semitone_confusion_negative")
        ),
        "octave_confusion_false_match_rate": _match_rate(
            _by_kind(evaluations, "octave_confusion_negative")
        ),
        "metrics_by_case_kind": {
            kind: _case_kind_metrics(_by_kind(evaluations, kind))
            for kind in (
                "positive",
                "missing_added_pitch_negative",
                "semitone_confusion_negative",
                "octave_confusion_negative",
            )
        },
        "evaluations": [
            _activation_evaluation_json(evaluation, activation_predictions)
            for evaluation in evaluations
        ],
        "first_20_positive_misses": [
            _activation_evaluation_json(evaluation, activation_predictions)
            for evaluation in positives
            if evaluation.result != "MATCH"
        ][:20],
        "first_20_false_matches": [
            _activation_evaluation_json(evaluation, activation_predictions)
            for evaluation in negatives
            if evaluation.result == "MATCH"
        ][:20],
    }


def _activation_evaluation_json(
    evaluation: StepCaseEvaluation,
    activation_predictions: dict[int, ActivationPrediction],
) -> dict[str, object]:
    data = _evaluation_json(evaluation)
    prediction = activation_predictions[evaluation.case.source_group_index]
    data["basic_pitch_activation"] = {
        "expected_evidence": {
            pitch: prediction["expected_evidence"].get(pitch)
            for pitch in evaluation.case.expected_pitches
        },
        "unexpected_evidence": prediction["unexpected_evidence"],
    }
    return data


def _all_case_expected_pitches(
    cases: tuple[StepCase, ...],
    *,
    source_group_index: int,
) -> tuple[str, ...]:
    pitches: list[str] = []
    for case in cases:
        if case.source_group_index != source_group_index:
            continue
        for pitch in case.expected_pitches:
            if pitch not in pitches:
                pitches.append(pitch)
    return tuple(pitches)


def _source_case_by_index(cases: tuple[StepCase, ...]) -> dict[int, StepCase]:
    source_cases: dict[int, StepCase] = {}
    for case in cases:
        source_cases.setdefault(case.source_group_index, case)
    return source_cases


def _slice_audio(
    audio: np.ndarray,
    *,
    sample_rate: int,
    start_seconds: float,
    end_seconds: float,
) -> np.ndarray:
    start = max(0, int(round(start_seconds * sample_rate)))
    end = min(audio.size, int(round(end_seconds * sample_rate)))
    if end <= start:
        return np.zeros(1, dtype=np.float32)
    return audio[start:end].astype(np.float32, copy=False)


def _write_pcm16_wav(path: Path, audio: np.ndarray, *, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())


if __name__ == "__main__":
    raise SystemExit(main())
