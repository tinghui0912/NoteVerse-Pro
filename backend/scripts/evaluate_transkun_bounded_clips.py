"""Evaluate Transkun on bounded audio clips from a frozen paired-MIDI manifest.

This benchmark answers a narrower question than full-recording AMT:
given a bounded audio clip around the current expected strike, can Transkun
produce evidence that safely verifies score-conditioned expected pitches?

The provider sees only the exported clip. It still uses a non-streaming model
inside that clip, so this is a bounded-clip provider benchmark, not the final
STEP runtime false-advance metric.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import wave

import numpy as np

from evaluate_public_paired_midi_dataset import (
    DEFAULT_CHORD_WINDOW_SECONDS,
    DEFAULT_SAMPLE_RATE,
    MidiStrikeGroup,
    group_note_ons,
    load_selection_manifest,
    parse_midi_note_ons,
    read_pcm_wav,
)
from evaluate_score_conditioned_step_cases import (
    StepCase,
    StepCaseEvaluation,
    _evaluate_expected,
    _file_sha256,
    _horizon_key,
    _manifest_audio_path,
    _match_rate,
    _by_kind,
    _case_kind_metrics,
    _evaluation_json,
    generate_step_cases,
    load_truth_groups_from_manifest,
)


BENCHMARK_SCOPE_TRANSKUN_BOUNDED_CLIPS = "transkun_bounded_clip_provider"
DEFAULT_PRE_ROLL_SECONDS = 0.25
CLIP_PIPELINE_VERSION = 1


def main() -> int:
    args = parse_args()
    manifest = load_selection_manifest(args.selection_manifest)
    truth_groups = load_truth_groups_from_manifest(manifest)
    cases = generate_step_cases(truth_groups, max_cases_per_kind=args.max_cases_per_kind)
    audio_path = _manifest_audio_path(manifest, base_path=args.selection_manifest.parent)
    if audio_path is None:
        raise ValueError("Selection manifest does not include dataset.audio_path")
    audio = read_pcm_wav(audio_path, sample_rate=args.sample_rate)
    audio_sha256 = _file_sha256(audio_path)
    checkpoint_sha256 = None if args.weight is None else _file_sha256(args.weight)
    conf_sha256 = None if args.conf is None else _file_sha256(args.conf)
    requested_source_indices = _parse_source_group_indices(args.source_group_indices)

    reports_by_horizon: dict[float, dict[str, object]] = {}
    runner: _TranskunRunner | None = None
    for horizon_seconds in args.horizon_seconds:
        source_indices = _selected_source_indices(
            cases,
            truth_groups=truth_groups,
            horizon_seconds=horizon_seconds,
            requested_source_indices=requested_source_indices,
            source_group_offset=args.source_group_offset,
            max_source_groups=args.max_source_groups,
            require_isolated_gesture=args.require_isolated_gesture,
        )
        if _has_missing_bounded_clip_transcriptions(
            cases=cases,
            source_indices=source_indices,
            horizon_seconds=horizon_seconds,
            pre_roll_seconds=args.pre_roll_seconds,
            audio_duration_seconds=audio.size / args.sample_rate,
            work_dir=args.work_dir,
            cache_context={
                "audio_sha256": audio_sha256,
                "provider_id": "transkun_v2_aug_bounded_clip",
                "provider_version": args.provider_version,
                "provider_checkpoint_sha256": checkpoint_sha256,
                "provider_conf_sha256": conf_sha256,
                "sample_rate_hz": args.sample_rate,
                "chord_window_seconds": args.chord_window_seconds,
                "clip_pipeline_version": CLIP_PIPELINE_VERSION,
            },
        ):
            runner = runner or _transkun_runner(
                runner_kind=args.runner,
                transkun_bin=args.transkun_bin,
                weight=args.weight,
                conf=args.conf,
                device=args.device,
            )
        clip_predictions = transcribe_bounded_clips(
            audio=audio,
            sample_rate=args.sample_rate,
            cases=cases,
            source_indices=source_indices,
            horizon_seconds=horizon_seconds,
            pre_roll_seconds=args.pre_roll_seconds,
            chord_window_seconds=args.chord_window_seconds,
            work_dir=args.work_dir,
            runner=runner,
            cache_context={
                "audio_sha256": audio_sha256,
                "provider_id": "transkun_v2_aug_bounded_clip",
                "provider_version": args.provider_version,
                "provider_checkpoint_sha256": checkpoint_sha256,
                "provider_conf_sha256": conf_sha256,
                "sample_rate_hz": args.sample_rate,
                "chord_window_seconds": args.chord_window_seconds,
                "clip_pipeline_version": CLIP_PIPELINE_VERSION,
            },
        )
        evaluations = evaluate_cases_from_clip_predictions(
            cases,
            clip_predictions=clip_predictions,
            horizon_seconds=horizon_seconds,
            pre_roll_seconds=args.pre_roll_seconds,
        )
        reports_by_horizon[horizon_seconds] = _horizon_report(
            horizon_seconds=horizon_seconds,
            evaluations=evaluations,
            clip_predictions=clip_predictions,
            truth_groups=truth_groups,
        )

    report = {
        "dataset": manifest.get("dataset", {}),
        "provider": {
            "provider_id": "transkun_v2_aug_bounded_clip",
            "provider_version": args.provider_version,
            "provider_checkpoint": str(args.weight) if args.weight else None,
            "provider_checkpoint_sha256": checkpoint_sha256,
            "provider_conf": str(args.conf) if args.conf else None,
            "provider_conf_sha256": conf_sha256,
            "runner": args.runner,
        },
        "benchmark": {
            "benchmark_scope": BENCHMARK_SCOPE_TRANSKUN_BOUNDED_CLIPS,
            "truth_source": "frozen_paired_midi_selection_manifest",
            "selection_manifest_path": str(args.selection_manifest),
            "selection_manifest_sha256": _file_sha256(args.selection_manifest),
            "audio_path": str(audio_path),
            "audio_sha256": audio_sha256,
            "onset_source": "paired_midi",
            "window_anchor_source": "paired_midi",
            "bounded_context": True,
            "future_beyond_decision_time": False,
            "streaming_causal": False,
            "causal_attempt_detection": False,
            "causal_runtime_loop": False,
            "source_selection_mode": (
                "no_subsequent_strike_within_horizon"
                if args.require_isolated_gesture
                else "explicit_source_group_indices"
                if requested_source_indices is not None
                else "manifest_order"
            ),
            "requested_source_group_indices": requested_source_indices,
            "product_false_advance_eligible": False,
            "product_false_advance_rate": None,
            "sample_rate_hz": args.sample_rate,
            "pre_roll_seconds": args.pre_roll_seconds,
            "source_group_offset": args.source_group_offset,
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
    parser.add_argument("--chord-window-seconds", type=float, default=DEFAULT_CHORD_WINDOW_SECONDS)
    parser.add_argument("--horizon-seconds", type=float, action="append", required=True)
    parser.add_argument("--source-group-offset", type=int, default=0)
    parser.add_argument(
        "--source-group-indices",
        default=None,
        help=(
            "Comma-separated source group indices to evaluate. When supplied, "
            "these exact source groups are used before any isolated filtering."
        ),
    )
    parser.add_argument("--max-source-groups", type=int, default=12)
    parser.add_argument(
        "--require-isolated-gesture",
        action="store_true",
        help=(
            "Only evaluate source groups with no later paired-MIDI strike inside "
            "the current decision horizon."
        ),
    )
    parser.add_argument("--max-cases-per-kind", type=int, default=None)
    parser.add_argument("--transkun-bin", default="transkun")
    parser.add_argument("--runner", choices=("cli", "inprocess"), default="cli")
    parser.add_argument("--weight", type=Path, default=None)
    parser.add_argument("--conf", type=Path, default=None)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--provider-version", default="2.0.1")
    return parser.parse_args()


class _TranskunRunner:
    def transcribe(self, clip_path: Path, midi_path: Path) -> None:
        raise NotImplementedError


class _TranskunCliRunner(_TranskunRunner):
    def __init__(
        self,
        *,
        transkun_bin: str,
        weight: Path | None,
        conf: Path | None,
        device: str,
    ) -> None:
        self._transkun_bin = transkun_bin
        self._weight = weight
        self._conf = conf
        self._device = device

    def transcribe(self, clip_path: Path, midi_path: Path) -> None:
        command = [self._transkun_bin, str(clip_path), str(midi_path), "--device", self._device]
        if self._weight is not None:
            command.extend(["--weight", str(self._weight)])
        if self._conf is not None:
            command.extend(["--conf", str(self._conf)])
        subprocess.run(command, check=True)


class _TranskunInProcessRunner(_TranskunRunner):
    def __init__(
        self,
        *,
        weight: Path | None,
        conf: Path | None,
        device: str,
    ) -> None:
        import moduleconf
        import pkg_resources
        import torch
        from transkun.transcribe import readAudio

        self._torch = torch
        self._read_audio = readAudio
        self._device = device
        weight_path = (
            Path(pkg_resources.resource_filename("transkun", "pretrained/2.0.pt"))
            if weight is None
            else weight
        )
        conf_path = (
            Path(pkg_resources.resource_filename("transkun", "pretrained/2.0.conf"))
            if conf is None
            else conf
        )
        conf_manager = moduleconf.parseFromFile(str(conf_path))
        transkun_model = conf_manager["Model"].module.TransKun
        model_conf = conf_manager["Model"].config
        checkpoint = torch.load(weight_path, map_location=device)
        model = transkun_model(conf=model_conf).to(device)
        if "best_state_dict" not in checkpoint:
            model.load_state_dict(checkpoint["state_dict"], strict=False)
        else:
            model.load_state_dict(checkpoint["best_state_dict"], strict=False)
        model.eval()
        self._model = model

    def transcribe(self, clip_path: Path, midi_path: Path) -> None:
        import soxr
        from transkun.Data import writeMidi

        torch = self._torch
        fs, audio = self._read_audio(str(clip_path))
        if fs != self._model.fs:
            audio = soxr.resample(audio, fs, self._model.fs)
        with torch.no_grad():
            tensor = torch.from_numpy(audio).to(self._device)
            notes = self._model.transcribe(tensor, discardSecondHalf=False)
        output_midi = writeMidi(notes)
        output_midi.write(str(midi_path))


def _transkun_runner(
    *,
    runner_kind: str,
    transkun_bin: str,
    weight: Path | None,
    conf: Path | None,
    device: str,
) -> _TranskunRunner:
    if runner_kind == "cli":
        return _TranskunCliRunner(
            transkun_bin=transkun_bin,
            weight=weight,
            conf=conf,
            device=device,
        )
    if runner_kind == "inprocess":
        return _TranskunInProcessRunner(weight=weight, conf=conf, device=device)
    raise ValueError(f"Unsupported Transkun runner: {runner_kind}")


def transcribe_bounded_clips(
    *,
    audio: np.ndarray,
    sample_rate: int,
    cases: tuple[StepCase, ...],
    source_indices: tuple[int, ...],
    horizon_seconds: float,
    pre_roll_seconds: float,
    chord_window_seconds: float,
    work_dir: Path,
    runner: _TranskunRunner | None,
    cache_context: dict[str, object],
) -> dict[int, tuple[MidiStrikeGroup, ...]]:
    source_case_by_index = _source_case_by_index(cases)
    predictions: dict[int, tuple[MidiStrikeGroup, ...]] = {}
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
        clip_stem = _clip_stem(
            source_index,
            pre_roll_seconds=pre_roll_seconds,
            horizon_seconds=horizon_seconds,
        )
        clip_path = work_dir / "clips" / f"{clip_stem}.wav"
        midi_path = work_dir / "transkun" / f"{clip_stem}.mid"
        cache_identity = _clip_cache_identity(
            case,
            cache_context=cache_context,
            clip_start_seconds=clip_start_seconds,
            clip_end_seconds=clip_end_seconds,
            pre_roll_seconds=pre_roll_seconds,
            horizon_seconds=horizon_seconds,
        )
        _write_pcm16_wav(clip_path, clip_audio, sample_rate=sample_rate)
        if not _cache_metadata_matches(midi_path, cache_identity):
            if runner is None:
                raise RuntimeError(f"Missing cached Transkun transcription: {midi_path}")
            midi_path.parent.mkdir(parents=True, exist_ok=True)
            runner.transcribe(clip_path, midi_path)
            _write_cache_metadata(midi_path, cache_identity)
        clip_groups = group_note_ons(
            parse_midi_note_ons(midi_path),
            chord_window_seconds=chord_window_seconds,
        )
        predictions[source_index] = tuple(
            MidiStrikeGroup(
                seconds=round(clip_start_seconds + group.seconds, 6),
                pitches=group.pitches,
                midi_notes=group.midi_notes,
            )
            for group in clip_groups
        )
    return predictions


def _has_missing_bounded_clip_transcriptions(
    *,
    cases: tuple[StepCase, ...],
    source_indices: tuple[int, ...],
    horizon_seconds: float,
    pre_roll_seconds: float,
    audio_duration_seconds: float,
    work_dir: Path,
    cache_context: dict[str, object],
) -> bool:
    source_case_by_index = _source_case_by_index(cases)
    for source_index in source_indices:
        if source_index not in source_case_by_index:
            continue
        case = source_case_by_index[source_index]
        clip_stem = _clip_stem(
            source_index,
            pre_roll_seconds=pre_roll_seconds,
            horizon_seconds=horizon_seconds,
        )
        midi_path = work_dir / "transkun" / f"{clip_stem}.mid"
        clip_start_seconds = max(0.0, case.seconds - pre_roll_seconds)
        clip_end_seconds = min(audio_duration_seconds, case.seconds + horizon_seconds)
        cache_identity = _clip_cache_identity(
            case,
            cache_context=cache_context,
            clip_start_seconds=clip_start_seconds,
            clip_end_seconds=clip_end_seconds,
            pre_roll_seconds=pre_roll_seconds,
            horizon_seconds=horizon_seconds,
        )
        if not _cache_metadata_matches(midi_path, cache_identity):
            return True
    return False


def _clip_stem(
    source_index: int,
    *,
    pre_roll_seconds: float,
    horizon_seconds: float,
) -> str:
    return (
        f"g{source_index:04d}"
        f"_pre{_horizon_key(pre_roll_seconds)}"
        f"_h{_horizon_key(horizon_seconds)}"
    )


def _clip_cache_identity(
    case: StepCase,
    *,
    cache_context: dict[str, object],
    clip_start_seconds: float,
    clip_end_seconds: float,
    pre_roll_seconds: float,
    horizon_seconds: float,
) -> dict[str, object]:
    return {
        **cache_context,
        "source_group_index": case.source_group_index,
        "case_seconds": round(case.seconds, 6),
        "actual_pitches": list(case.actual_pitches),
        "clip_start_seconds": round(clip_start_seconds, 6),
        "clip_end_seconds": round(clip_end_seconds, 6),
        "pre_roll_seconds": pre_roll_seconds,
        "horizon_seconds": horizon_seconds,
        "cache_format_version": 1,
    }


def _cache_metadata_matches(midi_path: Path, cache_identity: dict[str, object]) -> bool:
    if not midi_path.exists():
        return False
    metadata_path = _cache_metadata_path(midi_path)
    if not metadata_path.exists():
        return False
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    return metadata == cache_identity


def _write_cache_metadata(midi_path: Path, cache_identity: dict[str, object]) -> None:
    metadata_path = _cache_metadata_path(midi_path)
    metadata_path.write_text(
        json.dumps(cache_identity, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _cache_metadata_path(midi_path: Path) -> Path:
    return midi_path.with_suffix(midi_path.suffix + ".json")


def evaluate_cases_from_clip_predictions(
    cases: tuple[StepCase, ...],
    *,
    clip_predictions: dict[int, tuple[MidiStrikeGroup, ...]],
    horizon_seconds: float,
    pre_roll_seconds: float,
) -> tuple[StepCaseEvaluation, ...]:
    selected_source_indices = set(clip_predictions)
    evaluations: list[StepCaseEvaluation] = []
    for case in cases:
        if case.source_group_index not in selected_source_indices:
            continue
        window_start = case.seconds - pre_roll_seconds
        window_end = case.seconds + horizon_seconds
        context_groups = tuple(
            group
            for group in clip_predictions[case.source_group_index]
            if window_start <= group.seconds <= window_end
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


def _horizon_report(
    *,
    horizon_seconds: float,
    evaluations: tuple[StepCaseEvaluation, ...],
    clip_predictions: dict[int, tuple[MidiStrikeGroup, ...]],
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
        "clip_count": len(clip_predictions),
        "selected_source_group_count": len(clip_predictions),
        "source_group_indices": tuple(sorted(clip_predictions)),
        "predicted_group_count": sum(len(groups) for groups in clip_predictions.values()),
        "correct_acceptance_rate": _match_rate(positives),
        "false_completion_rate": _match_rate(negatives),
        "false_completion_rate_excluding_contaminated_negatives": _match_rate(
            uncontaminated_negatives
        ),
        "contaminated_negative_case_count": len(contaminated_negatives),
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
            _bounded_evaluation_json(
                evaluation,
                truth_groups=truth_groups,
                horizon_seconds=horizon_seconds,
            )
            for evaluation in evaluations
        ],
        "first_20_positive_misses": [
            _bounded_evaluation_json(
                evaluation,
                truth_groups=truth_groups,
                horizon_seconds=horizon_seconds,
            )
            for evaluation in positives
            if evaluation.result != "MATCH"
        ][:20],
        "first_20_false_matches": [
            _bounded_evaluation_json(
                evaluation,
                truth_groups=truth_groups,
                horizon_seconds=horizon_seconds,
            )
            for evaluation in negatives
            if evaluation.result == "MATCH"
        ][:20],
        "first_20_contaminated_false_matches": [
            _bounded_evaluation_json(
                evaluation,
                truth_groups=truth_groups,
                horizon_seconds=horizon_seconds,
            )
            for evaluation in contaminated_negatives
            if evaluation.result == "MATCH"
        ][:20],
        "first_20_uncontaminated_false_matches": [
            _bounded_evaluation_json(
                evaluation,
                truth_groups=truth_groups,
                horizon_seconds=horizon_seconds,
            )
            for evaluation in uncontaminated_negatives
            if evaluation.result == "MATCH"
        ][:20],
    }


def _bounded_evaluation_json(
    evaluation: StepCaseEvaluation,
    *,
    truth_groups: tuple[MidiStrikeGroup, ...],
    horizon_seconds: float,
) -> dict[str, object]:
    data = _evaluation_json(evaluation)
    later_truth_pitches = _later_truth_pitches(
        evaluation.case,
        truth_groups=truth_groups,
        horizon_seconds=horizon_seconds,
    )
    supported_extra = tuple(
        pitch for pitch in evaluation.extra_observed if pitch in later_truth_pitches
    )
    unsupported_extra = tuple(
        pitch for pitch in evaluation.extra_observed if pitch not in later_truth_pitches
    )
    later_supported_expected = tuple(
        pitch
        for pitch in evaluation.case.expected_pitches
        if pitch not in evaluation.case.actual_pitches and pitch in later_truth_pitches
    )
    data["continuous_performance_contamination"] = {
        "later_truth_pitches_within_horizon": later_truth_pitches,
        "extra_observed_supported_by_later_truth": supported_extra,
        "extra_observed_unsupported_by_later_truth": unsupported_extra,
        "counterfactual_expected_supported_by_later_truth": later_supported_expected,
        "contaminated_negative_match": _is_contaminated_negative_match(
            evaluation,
            truth_groups=truth_groups,
            horizon_seconds=horizon_seconds,
        ),
    }
    return data


def _is_contaminated_negative_match(
    evaluation: StepCaseEvaluation,
    *,
    truth_groups: tuple[MidiStrikeGroup, ...],
    horizon_seconds: float,
) -> bool:
    if evaluation.case.kind == "positive" or evaluation.result != "MATCH":
        return False
    later_truth_pitches = _later_truth_pitches(
        evaluation.case,
        truth_groups=truth_groups,
        horizon_seconds=horizon_seconds,
    )
    return any(
        pitch not in evaluation.case.actual_pitches and pitch in later_truth_pitches
        for pitch in evaluation.case.expected_pitches
    )


def _later_truth_pitches(
    case: StepCase,
    *,
    truth_groups: tuple[MidiStrikeGroup, ...],
    horizon_seconds: float,
) -> tuple[str, ...]:
    window_start = case.seconds
    window_end = case.seconds + horizon_seconds
    pitches: list[str] = []
    for group in truth_groups:
        if group.seconds <= window_start + 1e-6 or group.seconds > window_end + 1e-6:
            continue
        for pitch in group.pitches:
            if pitch not in pitches:
                pitches.append(pitch)
    return tuple(pitches)


def _selected_source_indices(
    cases: tuple[StepCase, ...],
    *,
    truth_groups: tuple[MidiStrikeGroup, ...],
    horizon_seconds: float,
    requested_source_indices: tuple[int, ...] | None,
    source_group_offset: int,
    max_source_groups: int,
    require_isolated_gesture: bool = False,
) -> tuple[int, ...]:
    if source_group_offset < 0:
        raise ValueError("source_group_offset must be non-negative")
    available_source_indices = tuple(dict.fromkeys(case.source_group_index for case in cases))
    if requested_source_indices is None:
        source_indices = available_source_indices
    else:
        available_set = set(available_source_indices)
        missing = tuple(index for index in requested_source_indices if index not in available_set)
        if missing:
            raise ValueError(f"Unknown source group indices: {missing}")
        source_indices = requested_source_indices
    if require_isolated_gesture:
        source_case_by_index = _source_case_by_index(cases)
        source_indices = tuple(
            source_index
            for source_index in source_indices
            if source_index in source_case_by_index
            and not _has_later_truth_within_horizon(
                source_case_by_index[source_index],
                truth_groups=truth_groups,
                horizon_seconds=horizon_seconds,
            )
        )
    return source_indices[source_group_offset : source_group_offset + max_source_groups]


def _parse_source_group_indices(value: str | None) -> tuple[int, ...] | None:
    if value is None or value.strip() == "":
        return None
    indices: list[int] = []
    for raw_part in value.split(","):
        part = raw_part.strip()
        if not part:
            continue
        index = int(part)
        if index < 0:
            raise ValueError("source group indices must be non-negative")
        if index not in indices:
            indices.append(index)
    return tuple(indices)


def _has_later_truth_within_horizon(
    case: StepCase,
    *,
    truth_groups: tuple[MidiStrikeGroup, ...],
    horizon_seconds: float,
) -> bool:
    return bool(
        _later_truth_pitches(
            case,
            truth_groups=truth_groups,
            horizon_seconds=horizon_seconds,
        )
    )


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
