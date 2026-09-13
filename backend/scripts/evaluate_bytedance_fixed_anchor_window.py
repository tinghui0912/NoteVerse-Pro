"""Evaluate a fixed-anchor bounded-window ByteDance direct note_model contract.

This research-only diagnostic compares an existing uncropped +220ms report
against a runtime-friendly deterministic input window:

    target anchor from tensor start = 1600ms
    real past audio = last up to 1000ms
    left zero padding = whatever is needed to keep the target at 1600ms
    future audio = 220ms

It does not touch the frozen evaluation set, does not tune thresholds, does not
scan anchors, and does not modify production recognition or progression code.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
from time import perf_counter

import numpy as np

from compare_step_microphone_frontends_causal_cases import (
    ByteDancePianoTranscriptionProvider,
    _activation_prediction,
    _case_audio_path,
    _case_source_identity,
    _evaluate_expected,
    _future_target_contamination,
    _read_wav,
    _write_wav,
)
from evaluate_bytedance_direct_note_frontend import (
    _checkpoint_path,
    _direct_note_forward,
    _sha256,
    _validate_policy,
    _warm_up_note_model,
)


TARGET_ANCHOR_MS = 1600
REAL_LOOKBACK_MS = 1000
FUTURE_PREFIX_MS = 220


def main() -> int:
    args = parse_args()
    policy_artifact = json.loads(args.policy.read_text(encoding="utf-8"))
    _validate_policy(policy_artifact)
    policy = policy_artifact["policy"]
    window = policy_artifact["benchmark_window"]
    frontend = policy_artifact["frontend"]
    checkpoint_path = _checkpoint_path(frontend)
    checkpoint_sha256 = _sha256(checkpoint_path)
    if checkpoint_sha256 != frontend["checkpoint_sha256"]:
        raise ValueError(
            "checkpoint SHA256 mismatch: "
            f"expected {frontend['checkpoint_sha256']}, got {checkpoint_sha256}"
        )

    a_report = json.loads(args.uncropped_report.read_text(encoding="utf-8"))
    a_reference = a_report["devices"][args.reference_device]["cases"][str(FUTURE_PREFIX_MS)]
    cases = [
        (manifest_path, case)
        for manifest_path in args.case_manifest
        for case in json.loads(manifest_path.read_text(encoding="utf-8")).get("cases", ())
    ]

    device_reports = {}
    for device in args.device:
        provider = ByteDancePianoTranscriptionProvider(
            checkpoint_path=checkpoint_path,
            device=device,
        )
        _warm_up_note_model(provider, device=device)
        fixed_anchor_evaluations = [
            _evaluate_case(
                manifest_path,
                case,
                provider=provider,
                device=device,
                work_dir=args.work_dir,
                local_pre_seconds=float(window["local_pre_seconds"]),
                local_post_seconds=float(window["local_post_seconds"]),
                decision_horizon_seconds=float(window["decision_horizon_seconds"]),
                onset_threshold=float(policy["target_onset_min"]),
                frame_threshold=float(policy["target_frame_min"]),
            )
            for manifest_path, case in cases
        ]
        disagreements = _disagreements(fixed_anchor_evaluations, a_reference)
        device_reports[device] = {
            "A_uncropped_220": _reference_summary(a_reference),
            "fixed_anchor": {
                **_reference_summary(fixed_anchor_evaluations),
                "agreement_vs_A": _agreement_summary(fixed_anchor_evaluations, a_reference),
                "disagreements_vs_A": disagreements,
                "activation_delta_vs_A": _activation_delta_summary(
                    fixed_anchor_evaluations,
                    a_reference,
                ),
                "zero_pad_ms_distribution": _zero_pad_distribution(fixed_anchor_evaluations),
                "available_real_lookback_ms_distribution": _available_lookback_distribution(
                    fixed_anchor_evaluations
                ),
                "latency": _latency_summary(fixed_anchor_evaluations),
            },
            "fixed_anchor_evaluations": fixed_anchor_evaluations,
        }

    report = {
        "benchmark_scope": "bytedance_fixed_anchor_bounded_window_candidate",
        "terminology": "bounded-window runtime research candidate",
        "not_truly_causal_streaming_reason": (
            "The frontend still uses centered STFT features and a bidirectional GRU."
        ),
        "frozen_evaluation_used": False,
        "production_modified": False,
        "grid_search": False,
        "policy_reselected": False,
        "anchor_sweep": False,
        "policy_artifact": str(args.policy),
        "uncropped_report": str(args.uncropped_report),
        "case_manifests": [str(path) for path in args.case_manifest],
        "case_count": len(cases),
        "checkpoint_sha256": checkpoint_sha256,
        "policy": policy,
        "benchmark_window": window,
        "fixed_anchor_contract": {
            "target_anchor_ms": TARGET_ANCHOR_MS,
            "real_lookback_ms": REAL_LOOKBACK_MS,
            "future_prefix_ms": FUTURE_PREFIX_MS,
            "typical_left_zero_padding_ms": TARGET_ANCHOR_MS - REAL_LOOKBACK_MS,
            "typical_tensor_duration_ms": TARGET_ANCHOR_MS + FUTURE_PREFIX_MS,
            "description": (
                "Use the last up to 1000ms of real past audio, prepend zeros so "
                "the target is always 1600ms from tensor start, then include "
                "220ms future audio."
            ),
        },
        "devices": device_reports,
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--uncropped-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--device", action="append", default=None)
    parser.add_argument("--reference-device", default="cuda")
    args = parser.parse_args()
    if args.device is None:
        args.device = ["cuda"]
    return args


def _evaluate_case(
    manifest_path: Path,
    case: dict[str, object],
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    work_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    decision_horizon_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[str, object]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
    if len(target_seconds) < len(expected_groups):
        target_seconds = tuple(source_start + 1.0 for _ in expected_groups)

    group_results = []
    latency_samples = []
    audio_duration_seconds = audio.size / sample_rate
    for index, expected_pitches in enumerate(expected_groups):
        target_second = target_seconds[index]
        relative_target = max(0.0, target_second - source_start)
        available_real_lookback_seconds = min(
            REAL_LOOKBACK_MS / 1000.0,
            relative_target,
        )
        real_start_relative = relative_target - available_real_lookback_seconds
        real_end_relative = min(audio_duration_seconds, relative_target + FUTURE_PREFIX_MS / 1000.0)
        real_audio = audio[
            int(round(real_start_relative * sample_rate)) : int(round(real_end_relative * sample_rate))
        ]
        zero_pad_seconds = TARGET_ANCHOR_MS / 1000.0 - available_real_lookback_seconds
        if zero_pad_seconds < -1e-9:
            raise ValueError(f"negative zero padding for {case.get('case_id')} group {index}")
        zero_pad = np.zeros(int(round(max(0.0, zero_pad_seconds) * sample_rate)), dtype=real_audio.dtype)
        clip_audio = np.concatenate([zero_pad, real_audio])
        clip_start_seconds = target_second - TARGET_ANCHOR_MS / 1000.0
        clip_path = (
            work_dir
            / f"bytedance_fixed_anchor_{device}"
            / (
                f"{case['case_id']}_g{index + 1:02d}"
                f"_anchor{TARGET_ANCHOR_MS}_real{REAL_LOOKBACK_MS}_future{FUTURE_PREFIX_MS}.wav"
            )
        )
        _write_wav(clip_path, clip_audio, sample_rate=sample_rate)

        end_to_end_started = perf_counter()
        raw_output, forward_latency = _direct_note_forward(
            provider,
            clip_audio,
            sample_rate,
            device=device,
        )
        prediction = _activation_prediction(
            raw_output,
            expected_pitches=expected_pitches,
            clip_start_seconds=clip_start_seconds,
            analysis_start_seconds=target_second - local_pre_seconds,
            analysis_end_seconds=target_second + local_post_seconds,
            target_second=target_second,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
        )
        _sync(device)
        end_to_end_ms = (perf_counter() - end_to_end_started) * 1000.0
        observed = tuple(
            pitch
            for pitch, evidence in prediction["expected_evidence"].items()
            if evidence["accepted"]
        )
        result, matched, missing, extra = _evaluate_expected(expected_pitches, observed)
        actual_pitches = actual_groups[index] if index < len(actual_groups) else ()
        contamination = _future_target_contamination(
            case,
            expected_pitches=expected_pitches,
            actual_pitches=actual_pitches,
            target_second=target_second,
            decision_end_seconds=target_second + decision_horizon_seconds,
        )
        future_available_ms = round(
            max(0.0, real_end_relative - relative_target) * 1000.0,
            3,
        )
        group_results.append(
            {
                "group_index": index,
                "target_second": round(target_second, 6),
                "expected_pitches": expected_pitches,
                "actual_pitches_at_target": actual_pitches,
                "observed_pitches": observed,
                "result": result,
                "matched_expected": matched,
                "missing_expected": missing,
                "extra_observed": extra,
                "expected_evidence": prediction["expected_evidence"],
                "chord_summary": prediction["chord_summary"],
                "future_target_contamination": contamination,
                "fixed_anchor_window": {
                    "target_anchor_ms": TARGET_ANCHOR_MS,
                    "available_real_lookback_ms": round(
                        available_real_lookback_seconds * 1000.0,
                        3,
                    ),
                    "zero_pad_ms": round(max(0.0, zero_pad_seconds) * 1000.0, 3),
                    "future_available_ms": future_available_ms,
                    "tensor_duration_ms": round((clip_audio.size / sample_rate) * 1000.0, 3),
                    "real_audio_start_relative_to_target_ms": round(
                        (real_start_relative - relative_target) * 1000.0,
                        3,
                    ),
                },
            }
        )
        latency_samples.append(
            {
                "forward_ms": round(forward_latency["forward_ms"], 3),
                "target_evidence_end_to_end_ms": round(end_to_end_ms, 3),
                "estimated_strike_to_decision_ms": round(
                    FUTURE_PREFIX_MS + end_to_end_ms,
                    3,
                ),
                "tensor_duration_ms": round((clip_audio.size / sample_rate) * 1000.0, 3),
            }
        )

    expected_advances = int(case.get("expected_advances", 0))
    matched_groups = sum(1 for group in group_results if group["result"] == "MATCH")
    accepted = matched_groups > 0 if expected_advances == 0 else matched_groups >= expected_advances
    return {
        "case_id": case.get("case_id"),
        "case_kind": case.get("case_kind"),
        "expected_advances": expected_advances,
        "matched_groups": matched_groups,
        "accepted": accepted,
        "future_target_contaminated": any(
            group["future_target_contamination"]["contaminated"]
            for group in group_results
        ),
        "source_identity": _case_source_identity(case),
        "group_results": group_results,
        "latency_samples": latency_samples,
    }


def _reference_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return {
        "metrics": _metrics_for(evaluations),
        "per_source_metrics": _per_source_metrics(evaluations),
        "no_local_model_frames": _no_local_frame_count(evaluations),
    }


def _metrics_for(evaluations: list[dict[str, object]]) -> dict[str, object]:
    by_kind: dict[str, list[dict[str, object]]] = defaultdict(list)
    for evaluation in evaluations:
        by_kind[str(evaluation["case_kind"])].append(evaluation)
    return {
        "correct_single": _rate(by_kind["correct_strike"]),
        "correct_chord": _rate(by_kind["correct_chord"]),
        "retrigger": _rate(by_kind["same_note_retrigger"]),
        "clean_semitone_false": _rate(
            evaluation
            for evaluation in by_kind["wrong_semitone"]
            if not bool(evaluation["future_target_contaminated"])
        ),
        "clean_octave_false": _rate(
            evaluation
            for evaluation in by_kind["wrong_octave"]
            if not bool(evaluation["future_target_contaminated"])
        ),
        "clean_missing_false": _rate(
            evaluation
            for evaluation in by_kind["missing_chord_tone"]
            if not bool(evaluation["future_target_contaminated"])
        ),
        "clean_negative_false": _rate(
            evaluation
            for kind in ("wrong_semitone", "wrong_octave", "missing_chord_tone")
            for evaluation in by_kind[kind]
            if not bool(evaluation["future_target_contaminated"])
        ),
    }


def _per_source_metrics(evaluations: list[dict[str, object]]) -> dict[str, object]:
    by_source: dict[str, list[dict[str, object]]] = defaultdict(list)
    for evaluation in evaluations:
        by_source[str(evaluation["source_identity"]["source_recording_id"])].append(evaluation)
    return {
        source: _metrics_for(source_evaluations)
        for source, source_evaluations in sorted(by_source.items())
    }


def _agreement_summary(
    evaluations: list[dict[str, object]],
    reference: list[dict[str, object]],
) -> dict[str, object]:
    reference_by_key = {_evaluation_key(evaluation): evaluation for evaluation in reference}
    total = 0
    accepted = 0
    for evaluation in evaluations:
        total += 1
        if bool(evaluation["accepted"]) == bool(reference_by_key[_evaluation_key(evaluation)]["accepted"]):
            accepted += 1
    return {"accepted": accepted, "total": total, "rate": round(accepted / total, 6) if total else None}


def _disagreements(
    evaluations: list[dict[str, object]],
    reference: list[dict[str, object]],
) -> list[dict[str, object]]:
    reference_by_key = {_evaluation_key(evaluation): evaluation for evaluation in reference}
    rows = []
    for evaluation in evaluations:
        reference_evaluation = reference_by_key[_evaluation_key(evaluation)]
        if bool(evaluation["accepted"]) == bool(reference_evaluation["accepted"]):
            continue
        target_times = tuple(evaluation["source_identity"].get("target_group_seconds") or ())
        group_rows = []
        for group, reference_group in zip(
            evaluation["group_results"],
            reference_evaluation["group_results"],
            strict=True,
        ):
            group_index = int(group["group_index"])
            previous_target = (
                target_times[group_index - 1]
                if group_index > 0 and group_index - 1 < len(target_times)
                else None
            )
            group_rows.append(
                {
                    "group_index": group_index,
                    "target_second": group["target_second"],
                    "available_real_lookback_ms": _window_value(
                        group,
                        "available_real_lookback_ms",
                    ),
                    "zero_pad_ms": _window_value(group, "zero_pad_ms"),
                    "target_anchor_ms": _window_value(group, "target_anchor_ms"),
                    "previous_target_distance_ms": (
                        round((float(group["target_second"]) - float(previous_target)) * 1000.0, 3)
                        if previous_target is not None
                        else None
                    ),
                    "A_result": reference_group["result"],
                    "fixed_anchor_result": group["result"],
                    "A_evidence": _expected_evidence_summary(reference_group),
                    "fixed_anchor_evidence": _expected_evidence_summary(group),
                }
            )
        rows.append(
            {
                "source_recording_id": evaluation["source_identity"]["source_recording_id"],
                "case_id": evaluation["case_id"],
                "case_kind": evaluation["case_kind"],
                "A_case_decision": bool(reference_evaluation["accepted"]),
                "fixed_anchor_case_decision": bool(evaluation["accepted"]),
                "groups": group_rows,
            }
        )
    return rows


def _activation_delta_summary(
    evaluations: list[dict[str, object]],
    reference: list[dict[str, object]],
) -> dict[str, object]:
    reference_by_key = {_evaluation_key(evaluation): evaluation for evaluation in reference}
    onset_deltas = []
    frame_deltas = []
    for evaluation in evaluations:
        reference_evaluation = reference_by_key[_evaluation_key(evaluation)]
        for group, reference_group in zip(
            evaluation["group_results"],
            reference_evaluation["group_results"],
            strict=True,
        ):
            for pitch, evidence in group["expected_evidence"].items():
                reference_evidence = reference_group["expected_evidence"][pitch]
                _append_delta(onset_deltas, evidence, reference_evidence, "onset_activation")
                _append_delta(frame_deltas, evidence, reference_evidence, "frame_activation")
    return {
        "onset_abs_mean": _mean_abs(onset_deltas),
        "onset_abs_max": _max_abs(onset_deltas),
        "frame_abs_mean": _mean_abs(frame_deltas),
        "frame_abs_max": _max_abs(frame_deltas),
    }


def _no_local_frame_count(evaluations: list[dict[str, object]]) -> dict[str, object]:
    count = 0
    for evaluation in evaluations:
        if any(
            evidence.get("local_evidence_status") == "NO_LOCAL_MODEL_FRAMES"
            for group in evaluation["group_results"]
            for evidence in group["expected_evidence"].values()
        ):
            count += 1
    return {"count": count, "total": len(evaluations)}


def _zero_pad_distribution(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return _distribution(
        [
            _window_value(group, "zero_pad_ms")
            for evaluation in evaluations
            for group in evaluation["group_results"]
        ]
    )


def _available_lookback_distribution(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return _distribution(
        [
            _window_value(group, "available_real_lookback_ms")
            for evaluation in evaluations
            for group in evaluation["group_results"]
        ]
    )


def _latency_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    forward = []
    end_to_end = []
    estimated = []
    tensor_duration = []
    for evaluation in evaluations:
        for sample in evaluation["latency_samples"]:
            forward.append(float(sample["forward_ms"]))
            end_to_end.append(float(sample["target_evidence_end_to_end_ms"]))
            estimated.append(float(sample["estimated_strike_to_decision_ms"]))
            tensor_duration.append(float(sample["tensor_duration_ms"]))
    return {
        "note_model_forward_ms": _distribution(forward),
        "target_evidence_end_to_end_ms": _distribution(end_to_end),
        "estimated_strike_to_decision_ms": _distribution(estimated),
        "actual_tensor_duration_ms": _distribution(tensor_duration),
        "sample_count": len(forward),
    }


def _rate(evaluations: object) -> dict[str, object]:
    items = tuple(evaluations)
    accepted = sum(1 for evaluation in items if bool(evaluation["accepted"]))
    total = len(items)
    return {"accepted": accepted, "total": total, "rate": round(accepted / total, 6) if total else None}


def _distribution(values: list[float]) -> dict[str, object]:
    if not values:
        return {"min": None, "median": None, "p95": None, "max": None, "mean": None}
    ordered = sorted(values)
    p95_index = min(len(ordered) - 1, int(np.ceil(len(ordered) * 0.95)) - 1)
    return {
        "min": round(float(ordered[0]), 6),
        "median": round(float(np.median(ordered)), 6),
        "p95": round(float(ordered[p95_index]), 6),
        "max": round(float(ordered[-1]), 6),
        "mean": round(float(np.mean(ordered)), 6),
    }


def _evaluation_key(evaluation: dict[str, object]) -> tuple[str, str]:
    return str(evaluation["source_identity"]["source_recording_id"]), str(evaluation["case_id"])


def _window_value(group: dict[str, object], key: str) -> float:
    return float(group["fixed_anchor_window"][key])


def _expected_evidence_summary(group: dict[str, object]) -> dict[str, object]:
    return {
        pitch: {
            "onset": evidence.get("onset_activation"),
            "frame": evidence.get("frame_activation"),
            "accepted": evidence.get("accepted"),
        }
        for pitch, evidence in group["expected_evidence"].items()
    }


def _append_delta(
    deltas: list[float],
    evidence: dict[str, object],
    reference_evidence: dict[str, object],
    key: str,
) -> None:
    value = evidence.get(key)
    reference_value = reference_evidence.get(key)
    if isinstance(value, (int, float)) and isinstance(reference_value, (int, float)):
        deltas.append(float(value) - float(reference_value))


def _mean_abs(values: list[float]) -> float | None:
    return round(sum(abs(value) for value in values) / len(values), 6) if values else None


def _max_abs(values: list[float]) -> float | None:
    return round(max(abs(value) for value in values), 6) if values else None


def _sync(device: str) -> None:
    if device == "cuda":
        import torch

        if torch.cuda.is_available():
            torch.cuda.synchronize()


if __name__ == "__main__":
    raise SystemExit(main())
