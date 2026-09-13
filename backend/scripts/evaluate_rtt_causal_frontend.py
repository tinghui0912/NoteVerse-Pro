"""Evaluate huispaty/rtt as a causal raw onset/frame frontend.

This research-only script uses the inspected development + calibration case
manifests. Runtime inference receives only sequential 16 kHz mono PCM for each
case clip. MIDI/ground truth is used after inference only for scoring.

No frozen evaluation set is used and no threshold grid search is performed.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
import sys
from time import perf_counter

import numpy as np

from compare_step_microphone_frontends_causal_cases import (
    _case_audio_path,
    _case_source_identity,
    _evaluate_expected,
    _future_target_contamination,
    _midi_note_name,
    _pitch_to_midi_note,
    _read_wav,
)


SAMPLE_RATE = 16_000
FRAMES_PER_SECOND = 100
MIDI_OFFSET = 21
ONSET_THRESHOLD = 0.5
FRAME_THRESHOLD = 0.3
GT_STRIKE_GROUP_TOLERANCE_SECONDS = 0.03
TARGET_MATCH_TOLERANCE_SECONDS = 0.05
CANDIDATE_MATCH_TOLERANCE_SECONDS = 0.05
DUPLICATE_STRIKE_WINDOW_SECONDS = 0.05
STEP_LOCAL_PRE_SECONDS = 0.03
STEP_LOCAL_POST_SECONDS = 0.08


def main() -> int:
    args = parse_args()
    _prepare_rtt_imports(args.rtt_repo)
    import torch

    from models import CustomAMT
    from pl_model import RTT

    device = torch.device(args.device if args.device else ("cuda" if torch.cuda.is_available() else "cpu"))
    model = CustomAMT()
    rtt_model = RTT.load_from_checkpoint(
        model=model,
        loss_function="weighted_bce_mse",
        checkpoint_path=str(args.checkpoint),
        map_location=device,
    )
    model = rtt_model.model.to(device).eval()
    parameter_count = sum(param.numel() for param in model.parameters())

    cases = [
        (manifest_path, case)
        for manifest_path in args.case_manifest
        for case in json.loads(manifest_path.read_text(encoding="utf-8")).get("cases", ())
    ]
    evaluations = [
        _evaluate_case(manifest_path, case, model=model, device=device, input_scale=args.input_scale)
        for manifest_path, case in cases
    ]

    report = {
        "benchmark_scope": "rtt_causal_raw_frontend_dev_cal",
        "candidate": {
            "repo": "https://github.com/huispaty/rtt",
            "repo_commit": args.rtt_commit,
            "paper": "Exploring System Adaptations for Minimum Latency Real-Time Piano Transcription",
            "license": "Apache-2.0",
            "checkpoint_path": str(args.checkpoint),
            "checkpoint_size_bytes": args.checkpoint.stat().st_size,
            "model_parameter_count": parameter_count,
        },
        "constraints": {
            "frozen_evaluation_used": False,
            "production_modified": False,
            "threshold_grid_search": False,
            "midi_oracle_runtime": False,
            "target_timestamp_runtime": False,
            "future_audio_runtime": False,
            "decoded_midi_used_for_scoring": False,
            "raw_outputs_used": ["onset_output", "frame_output", "velocity_output", "offset_output"],
        },
        "runtime_contract": {
            "input": "sequential 16 kHz mono PCM case clip",
            "input_scale": args.input_scale,
            "input_scale_note": _input_scale_note(args.input_scale),
            "sample_rate_hz": SAMPLE_RATE,
            "hop_seconds": 1 / FRAMES_PER_SECOND,
            "frames_per_second": FRAMES_PER_SECOND,
            "algorithmic_audio_latency_estimate_ms": 10.0,
            "latency_reason": "LogMelSpect uses fft_delay=160 samples at 16kHz; conv/GRU stacks are causal/unidirectional.",
        },
        "policy": {
            "onset_threshold": ONSET_THRESHOLD,
            "frame_threshold": FRAME_THRESHOLD,
            "candidate_rule": "per-pitch onset rising edge >= onset_threshold; same-frame active pitches grouped into one physical-strike candidate",
            "step_rule": "expected pitch accepted when local onset >= 0.5 and local frame >= 0.3",
            "step_local_window_seconds": [-STEP_LOCAL_PRE_SECONDS, STEP_LOCAL_POST_SECONDS],
        },
        "case_manifests": [str(path) for path in args.case_manifest],
        "case_count": len(cases),
        "summary": {
            "physical_strike": _physical_strike_summary(evaluations),
            "step": _step_summary(evaluations),
            "latency": _latency_summary(evaluations),
            "per_source_step": _per_source_step_summary(evaluations),
        },
        "evaluations": evaluations,
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rtt-repo", type=Path, required=True)
    parser.add_argument("--rtt-commit", default="unknown")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--device", default=None)
    parser.add_argument(
        "--input-scale",
        choices=("official_float", "int16_range"),
        default="official_float",
        help=(
            "official_float follows repository inference.py. int16_range follows "
            "CustomAMT.forward's explicit division by int16 range."
        ),
    )
    return parser.parse_args()


def _input_scale_note(input_scale: str) -> str:
    if input_scale == "official_float":
        return (
            "Follow repository inference.py: float PCM from WAV/librosa is passed into "
            "CustomAMT, whose forward() divides by int16 range."
        )
    return (
        "Pass float PCM multiplied by 32768 into CustomAMT so its forward() division "
        "by int16 range restores approximately [-1, 1] audio."
    )


def _prepare_rtt_imports(rtt_repo: Path) -> None:
    src = rtt_repo / "src"
    sys.path.insert(0, str(src.resolve()))


def _evaluate_case(
    manifest_path: Path,
    case: dict[str, object],
    *,
    model: object,
    device: object,
    input_scale: str,
) -> dict[str, object]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE}Hz case audio, got {sample_rate}")
    output, latency = _predict_rtt_raw(model, audio, device=device, input_scale=input_scale)
    candidates = _candidate_strikes(output["onset_output"], output["frame_output"])
    gt_groups = _ground_truth_strike_groups(case)
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
    if len(target_seconds) < len(expected_groups):
        target_seconds = tuple(1.0 for _ in expected_groups)

    group_results = []
    matched_groups = 0
    for index, expected_pitches in enumerate(expected_groups):
        target_second = target_seconds[index]
        actual_pitches = actual_groups[index] if index < len(actual_groups) else ()
        observed = []
        evidence = {}
        for pitch in expected_pitches:
            pitch_evidence = _pitch_local_evidence(
                output,
                pitch=pitch,
                target_second=target_second,
            )
            evidence[pitch] = pitch_evidence
            if pitch_evidence["accepted"]:
                observed.append(pitch)
        result, matched, missing, extra = _evaluate_expected(expected_pitches, tuple(observed))
        if result == "MATCH":
            matched_groups += 1
        contamination = _future_target_contamination(
            case,
            expected_pitches=expected_pitches,
            actual_pitches=actual_pitches,
            target_second=target_second,
            decision_end_seconds=target_second + STEP_LOCAL_POST_SECONDS,
        )
        group_results.append(
            {
                "group_index": index,
                "target_second": round(target_second, 6),
                "expected_pitches": expected_pitches,
                "actual_pitches_at_target": actual_pitches,
                "observed_pitches": tuple(observed),
                "result": result,
                "matched_expected": matched,
                "missing_expected": missing,
                "extra_observed": extra,
                "expected_evidence": evidence,
                "future_target_contamination": contamination,
            }
        )

    expected_advances = int(case.get("expected_advances", 0))
    accepted = matched_groups > 0 if expected_advances == 0 else matched_groups >= expected_advances
    return {
        "case_id": case.get("case_id"),
        "case_kind": case.get("case_kind"),
        "expected_advances": expected_advances,
        "matched_groups": matched_groups,
        "accepted": accepted,
        "future_target_contaminated": any(
            group["future_target_contamination"]["contaminated"] for group in group_results
        ),
        "source_identity": _case_source_identity(case),
        "gt_strike_groups": gt_groups,
        "candidate_strikes": candidates,
        "physical_strike_scoring": _score_candidates(candidates, gt_groups, target_seconds),
        "group_results": group_results,
        "latency": latency,
    }


def _predict_rtt_raw(
    model: object,
    audio: np.ndarray,
    *,
    device: object,
    input_scale: str,
) -> tuple[dict[str, np.ndarray], dict[str, float]]:
    import torch

    model_audio = audio * 32768.0 if input_scale == "int16_range" else audio
    started = perf_counter()
    tensor = torch.tensor(model_audio[None, :], device=device)
    h2d_ms = (perf_counter() - started) * 1000.0
    if str(device).startswith("cuda"):
        torch.cuda.synchronize()
    forward_started = perf_counter()
    with torch.inference_mode():
        output = model(tensor)
        output = {key: torch.sigmoid(value) for key, value in output.items()}
    if str(device).startswith("cuda"):
        torch.cuda.synchronize()
    forward_ms = (perf_counter() - forward_started) * 1000.0
    cpu_started = perf_counter()
    arrays = {key: value.detach().cpu().numpy()[0] for key, value in output.items()}
    cpu_ms = (perf_counter() - cpu_started) * 1000.0
    return arrays, {
        "h2d_ms": round(h2d_ms, 3),
        "forward_ms": round(forward_ms, 3),
        "to_cpu_ms": round(cpu_ms, 3),
        "compute_ms": round(h2d_ms + forward_ms + cpu_ms, 3),
        "estimated_strike_to_decision_ms": round(10.0 + h2d_ms + forward_ms + cpu_ms, 3),
    }


def _candidate_strikes(onsets: np.ndarray, frames: np.ndarray) -> list[dict[str, object]]:
    active = onsets >= ONSET_THRESHOLD
    rising = np.concatenate([active[:1, :], active[1:, :] & ~active[:-1, :]], axis=0)
    candidates = []
    for frame_index in np.where(np.any(rising, axis=1))[0]:
        pitch_indices = np.where(rising[frame_index])[0]
        pitches = tuple(_midi_note_name(MIDI_OFFSET + int(index)) for index in pitch_indices)
        frame_values = {
            pitch: {
                "onset": round(float(onsets[frame_index, int(index)]), 6),
                "frame": round(float(frames[frame_index, int(index)]), 6),
            }
            for pitch, index in zip(pitches, pitch_indices, strict=True)
        }
        candidates.append(
            {
                "anchor_second": round(float(frame_index) / FRAMES_PER_SECOND, 6),
                "frame_index": int(frame_index),
                "pitches": pitches,
                "evidence": frame_values,
            }
        )
    return candidates


def _ground_truth_strike_groups(case: dict[str, object]) -> list[dict[str, object]]:
    events = sorted(
        case.get("ground_truth_note_events", ()),
        key=lambda event: float(event["start_seconds"]),
    )
    groups: list[dict[str, object]] = []
    for event in events:
        start = float(event["start_seconds"])
        if groups and start - float(groups[-1]["anchor_second"]) <= GT_STRIKE_GROUP_TOLERANCE_SECONDS:
            groups[-1]["pitches"].append(str(event["pitch"]))
            groups[-1]["midi_notes"].append(int(event["midi_note"]))
        else:
            groups.append(
                {
                    "anchor_second": round(start, 6),
                    "pitches": [str(event["pitch"])],
                    "midi_notes": [int(event["midi_note"])],
                }
            )
    for group in groups:
        group["pitches"] = tuple(dict.fromkeys(group["pitches"]))
        group["midi_notes"] = tuple(dict.fromkeys(group["midi_notes"]))
    return groups


def _score_candidates(
    candidates: list[dict[str, object]],
    gt_groups: list[dict[str, object]],
    target_seconds: tuple[float, ...],
) -> dict[str, object]:
    matched_candidate_indices = set()
    matched_gt_indices = set()
    target_hits = 0
    timing_errors = []
    emit_delays = []
    for gt_index, group in enumerate(gt_groups):
        gt_time = float(group["anchor_second"])
        nearest = _nearest_candidate(candidates, gt_time)
        if nearest is not None and abs(float(nearest[1]["anchor_second"]) - gt_time) <= CANDIDATE_MATCH_TOLERANCE_SECONDS:
            candidate_index, candidate = nearest
            matched_gt_indices.add(gt_index)
            matched_candidate_indices.add(candidate_index)
            error = float(candidate["anchor_second"]) - gt_time
            timing_errors.append(error)
            emit_delays.append(max(0.0, error))
    for target in target_seconds:
        nearest = _nearest_candidate(candidates, target)
        if nearest is not None and abs(float(nearest[1]["anchor_second"]) - target) <= TARGET_MATCH_TOLERANCE_SECONDS:
            target_hits += 1
    duplicates = 0
    for gt_index, group in enumerate(gt_groups):
        gt_time = float(group["anchor_second"])
        near_count = sum(
            1
            for candidate in candidates
            if abs(float(candidate["anchor_second"]) - gt_time) <= DUPLICATE_STRIKE_WINDOW_SECONDS
        )
        duplicates += max(0, near_count - 1)
    duration_seconds = _case_duration_seconds(gt_groups, candidates)
    unmatched = len(candidates) - len(matched_candidate_indices)
    return {
        "all_gt_recall_hit": len(matched_gt_indices),
        "all_gt_recall_total": len(gt_groups),
        "target_recall_hit": target_hits,
        "target_recall_total": len(target_seconds),
        "unmatched_candidates": unmatched,
        "unmatched_candidates_per_minute": round(unmatched / max(duration_seconds / 60.0, 1e-9), 6),
        "duplicate_candidates": duplicates,
        "duplicate_candidates_per_strike": round(duplicates / len(gt_groups), 6) if gt_groups else None,
        "anchor_errors_ms": [round(value * 1000.0, 3) for value in timing_errors],
        "emit_delays_ms": [round(value * 1000.0, 3) for value in emit_delays],
    }


def _nearest_candidate(
    candidates: list[dict[str, object]],
    target_second: float,
) -> tuple[int, dict[str, object]] | None:
    if not candidates:
        return None
    index, candidate = min(
        enumerate(candidates),
        key=lambda item: abs(float(item[1]["anchor_second"]) - target_second),
    )
    return index, candidate


def _case_duration_seconds(gt_groups: list[dict[str, object]], candidates: list[dict[str, object]]) -> float:
    last = 0.0
    if gt_groups:
        last = max(last, max(float(group["anchor_second"]) for group in gt_groups))
    if candidates:
        last = max(last, max(float(candidate["anchor_second"]) for candidate in candidates))
    return max(last, 1.0)


def _pitch_local_evidence(
    output: dict[str, np.ndarray],
    *,
    pitch: str,
    target_second: float,
) -> dict[str, object]:
    midi = _pitch_to_midi_note(pitch)
    pitch_index = midi - MIDI_OFFSET
    if pitch_index < 0 or pitch_index >= output["onset_output"].shape[1]:
        return {
            "pitch": pitch,
            "local_evidence_status": "PITCH_OUT_OF_MODEL_RANGE",
            "onset_activation": None,
            "frame_activation": None,
            "accepted": False,
        }
    frame_times = np.arange(output["onset_output"].shape[0], dtype=np.float32) / FRAMES_PER_SECOND
    mask = (frame_times >= target_second - STEP_LOCAL_PRE_SECONDS) & (
        frame_times <= target_second + STEP_LOCAL_POST_SECONDS
    )
    if not np.any(mask):
        return {
            "pitch": pitch,
            "local_evidence_status": "NO_LOCAL_MODEL_FRAMES",
            "onset_activation": None,
            "frame_activation": None,
            "accepted": False,
        }
    onset_values = output["onset_output"][mask, pitch_index]
    frame_values = output["frame_output"][mask, pitch_index]
    onset_max = float(np.max(onset_values))
    frame_max = float(np.max(frame_values))
    return {
        "pitch": pitch,
        "local_evidence_status": "AVAILABLE",
        "onset_activation": round(onset_max, 6),
        "frame_activation": round(frame_max, 6),
        "accepted": onset_max >= ONSET_THRESHOLD and frame_max >= FRAME_THRESHOLD,
    }


def _physical_strike_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    total_gt = sum(int(e["physical_strike_scoring"]["all_gt_recall_total"]) for e in evaluations)
    hit_gt = sum(int(e["physical_strike_scoring"]["all_gt_recall_hit"]) for e in evaluations)
    total_target = sum(int(e["physical_strike_scoring"]["target_recall_total"]) for e in evaluations)
    hit_target = sum(int(e["physical_strike_scoring"]["target_recall_hit"]) for e in evaluations)
    unmatched_per_minute = [
        float(e["physical_strike_scoring"]["unmatched_candidates_per_minute"]) for e in evaluations
    ]
    duplicate_per_strike = [
        float(e["physical_strike_scoring"]["duplicate_candidates_per_strike"])
        for e in evaluations
        if e["physical_strike_scoring"]["duplicate_candidates_per_strike"] is not None
    ]
    errors = [
        float(value)
        for e in evaluations
        for value in e["physical_strike_scoring"]["anchor_errors_ms"]
    ]
    delays = [
        float(value)
        for e in evaluations
        for value in e["physical_strike_scoring"]["emit_delays_ms"]
    ]
    by_kind: dict[str, list[dict[str, object]]] = defaultdict(list)
    for evaluation in evaluations:
        by_kind[str(evaluation["case_kind"])].append(evaluation)
    return {
        "all_gt_strike_recall": _fraction(hit_gt, total_gt),
        "target_strike_recall": _fraction(hit_target, total_target),
        "single_target_recall": _target_recall_for(by_kind["correct_strike"]),
        "chord_target_recall": _target_recall_for(by_kind["correct_chord"]),
        "retrigger_target_recall": _target_recall_for(by_kind["same_note_retrigger"]),
        "unmatched_candidates_per_minute": _distribution(unmatched_per_minute),
        "duplicate_candidates_per_strike": _distribution(duplicate_per_strike),
        "anchor_timing_error_ms": _signed_distribution(errors),
        "emit_delay_ms": _distribution(delays),
    }


def _target_recall_for(evaluations: list[dict[str, object]]) -> dict[str, object]:
    hit = sum(int(e["physical_strike_scoring"]["target_recall_hit"]) for e in evaluations)
    total = sum(int(e["physical_strike_scoring"]["target_recall_total"]) for e in evaluations)
    return _fraction(hit, total)


def _step_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    by_kind: dict[str, list[dict[str, object]]] = defaultdict(list)
    for evaluation in evaluations:
        by_kind[str(evaluation["case_kind"])].append(evaluation)
    return {
        "correct_single": _case_acceptance(by_kind["correct_strike"]),
        "correct_chord": _case_acceptance(by_kind["correct_chord"]),
        "retrigger": _case_acceptance(by_kind["same_note_retrigger"]),
        "clean_semitone_false": _case_acceptance(
            [e for e in by_kind["wrong_semitone"] if not bool(e["future_target_contaminated"])]
        ),
        "clean_octave_false": _case_acceptance(
            [e for e in by_kind["wrong_octave"] if not bool(e["future_target_contaminated"])]
        ),
        "clean_missing_false": _case_acceptance(
            [e for e in by_kind["missing_chord_tone"] if not bool(e["future_target_contaminated"])]
        ),
    }


def _per_source_step_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    by_source: dict[str, list[dict[str, object]]] = defaultdict(list)
    for evaluation in evaluations:
        by_source[str(evaluation["source_identity"]["source_recording_id"])].append(evaluation)
    return {source: _step_summary(items) for source, items in sorted(by_source.items())}


def _case_acceptance(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return _fraction(sum(1 for e in evaluations if bool(e["accepted"])), len(evaluations))


def _latency_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return {
        "compute_ms": _distribution([float(e["latency"]["compute_ms"]) for e in evaluations]),
        "forward_ms": _distribution([float(e["latency"]["forward_ms"]) for e in evaluations]),
        "estimated_strike_to_decision_ms": _distribution(
            [float(e["latency"]["estimated_strike_to_decision_ms"]) for e in evaluations]
        ),
    }


def _fraction(hit: int, total: int) -> dict[str, object]:
    return {"accepted": hit, "total": total, "rate": round(hit / total, 6) if total else None}


def _distribution(values: list[float]) -> dict[str, object]:
    if not values:
        return {"count": 0, "min": None, "median": None, "p95": None, "max": None, "mean": None}
    ordered = sorted(values)
    p95_index = min(len(ordered) - 1, int(np.ceil(len(ordered) * 0.95)) - 1)
    return {
        "count": len(values),
        "min": round(float(ordered[0]), 6),
        "median": round(float(np.median(ordered)), 6),
        "p95": round(float(ordered[p95_index]), 6),
        "max": round(float(ordered[-1]), 6),
        "mean": round(float(np.mean(values)), 6),
    }


def _signed_distribution(values: list[float]) -> dict[str, object]:
    data = _distribution(values)
    data["p05"] = round(float(np.percentile(values, 5)), 6) if values else None
    return data


if __name__ == "__main__":
    raise SystemExit(main())
