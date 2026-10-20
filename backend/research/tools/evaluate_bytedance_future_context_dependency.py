"""Measure ByteDance STEP evidence dependency on bounded future context.

This research-only script uses development/calibration cases, not the frozen
evaluation set. It keeps the frozen policy thresholds fixed and compares shorter
causal prefixes against the +350 ms reference prefix.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
from time import perf_counter

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


DEFAULT_PREFIX_MS = (80, 120, 160, 220, 350)


def main() -> int:
    args = parse_args()
    policy_artifact = json.loads(args.policy.read_text(encoding="utf-8"))
    _validate_policy(policy_artifact)
    manifests = [
        (path, json.loads(path.read_text(encoding="utf-8"))) for path in args.case_manifest
    ]
    cases = [
        (manifest_path, case)
        for manifest_path, manifest in manifests
        for case in manifest.get("cases", ())
    ]
    if args.max_cases is not None:
        cases = cases[: args.max_cases]
    prefix_ms_values = tuple(args.prefix_ms or DEFAULT_PREFIX_MS)
    if 350 not in prefix_ms_values:
        raise ValueError("prefix list must include the +350 ms reference")

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

    device_reports = {}
    for device in args.device:
        provider = ByteDancePianoTranscriptionProvider(
            checkpoint_path=checkpoint_path,
            device=device,
        )
        prefix_results = {
            prefix_ms: _evaluate_prefix(
                cases,
                provider=provider,
                device=device,
                prefix_ms=prefix_ms,
                work_dir=args.work_dir,
                local_pre_seconds=float(window["local_pre_seconds"]),
                local_post_seconds=float(window["local_post_seconds"]),
                decision_horizon_seconds=float(window["decision_horizon_seconds"]),
                onset_threshold=float(policy["target_onset_min"]),
                frame_threshold=float(policy["target_frame_min"]),
            )
            for prefix_ms in prefix_ms_values
        }
        device_reports[device] = {
            "prefixes": {
                str(prefix_ms): _prefix_summary(
                    prefix_results[prefix_ms],
                    reference=prefix_results[350],
                )
                for prefix_ms in prefix_ms_values
            },
            "cases": {
                str(prefix_ms): prefix_results[prefix_ms]
                for prefix_ms in prefix_ms_values
            },
        }

    report = {
        "benchmark_scope": "bytedance_future_context_dependency",
        "frozen_evaluation_used": False,
        "production_modified": False,
        "grid_search": False,
        "policy_reselected": False,
        "policy_artifact": str(args.policy),
        "case_manifests": [str(path) for path in args.case_manifest],
        "case_count": len(cases),
        "case_limit": args.max_cases,
        "prefix_ms_values": list(prefix_ms_values),
        "reference_prefix_ms": 350,
        "checkpoint_sha256": checkpoint_sha256,
        "policy": policy,
        "benchmark_window": window,
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
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--device", action="append", default=None)
    parser.add_argument("--prefix-ms", type=int, action="append", default=None)
    parser.add_argument("--max-cases", type=int, default=None)
    args = parser.parse_args()
    if args.device is None:
        args.device = ["cuda"]
    return args


def _evaluate_prefix(
    cases: list[tuple[Path, dict[str, object]]],
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    prefix_ms: int,
    work_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    decision_horizon_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> list[dict[str, object]]:
    results = []
    total_wall_seconds = 0.0
    inference_count = 0
    for manifest_path, case in cases:
        case_result, wall_seconds, count = _evaluate_case_prefix(
            manifest_path,
            case,
            provider=provider,
            device=device,
            prefix_ms=prefix_ms,
            work_dir=work_dir,
            local_pre_seconds=local_pre_seconds,
            local_post_seconds=local_post_seconds,
            decision_horizon_seconds=decision_horizon_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
        )
        results.append(case_result)
        total_wall_seconds += wall_seconds
        inference_count += count
    for result in results:
        result["prefix_run_summary"] = {
            "device": device,
            "prefix_ms": prefix_ms,
            "total_inference_wall_seconds": round(total_wall_seconds, 6),
            "inference_count": inference_count,
            "mean_inference_wall_ms": round(total_wall_seconds * 1000.0 / inference_count, 3)
            if inference_count
            else None,
        }
    return results


def _evaluate_case_prefix(
    manifest_path: Path,
    case: dict[str, object],
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    prefix_ms: int,
    work_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    decision_horizon_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> tuple[dict[str, object], float, int]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
    if len(target_seconds) < len(expected_groups):
        target_seconds = tuple(source_start + 1.0 for _ in expected_groups)

    total_wall_seconds = 0.0
    inference_count = 0
    group_results = []
    for index, expected_pitches in enumerate(expected_groups):
        target_second = target_seconds[index]
        relative_target = max(0.0, target_second - source_start)
        clip_end_seconds = min(audio.size / sample_rate, relative_target + prefix_ms / 1000.0)
        clip_audio = audio[: int(round(clip_end_seconds * sample_rate))]
        clip_path = (
            work_dir
            / f"bytedance_future_context_{device}_prefix{prefix_ms}"
            / (
                f"{case['case_id']}_g{index + 1:02d}"
                f"_prefix{prefix_ms}_local{_safe_float(local_pre_seconds)}-"
                f"{_safe_float(local_post_seconds)}.wav"
            )
        )
        _write_wav(clip_path, clip_audio, sample_rate=sample_rate)
        started = perf_counter()
        raw_output = provider(clip_audio, sample_rate, clip_path)
        total_wall_seconds += perf_counter() - started
        inference_count += 1
        prediction = _activation_prediction(
            raw_output,
            expected_pitches=expected_pitches,
            clip_start_seconds=source_start,
            analysis_start_seconds=target_second - local_pre_seconds,
            analysis_end_seconds=target_second + local_post_seconds,
            target_second=target_second,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
        )
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
                "clip_prefix_ms": prefix_ms,
            }
        )
    expected_advances = int(case.get("expected_advances", 0))
    matched_groups = sum(1 for group in group_results if group["result"] == "MATCH")
    accepted = matched_groups > 0 if expected_advances == 0 else matched_groups >= expected_advances
    return (
        {
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
        },
        total_wall_seconds,
        inference_count,
    )


def _prefix_summary(
    evaluations: list[dict[str, object]],
    *,
    reference: list[dict[str, object]],
) -> dict[str, object]:
    reference_by_case = {_evaluation_key(evaluation): evaluation for evaluation in reference}
    agreement_total = 0
    agreement_count = 0
    onset_deltas = []
    frame_deltas = []
    for evaluation in evaluations:
        reference_evaluation = reference_by_case[_evaluation_key(evaluation)]
        agreement_total += 1
        agreement_count += int(bool(evaluation["accepted"]) == bool(reference_evaluation["accepted"]))
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
        "metrics": _metrics_for(evaluations),
        "decision_agreement_with_350ms": {
            "accepted": agreement_count,
            "total": agreement_total,
            "rate": round(agreement_count / agreement_total, 6) if agreement_total else None,
        },
        "activation_delta_vs_350ms": {
            "onset_abs_mean": _mean_abs(onset_deltas),
            "onset_abs_max": _max_abs(onset_deltas),
            "frame_abs_mean": _mean_abs(frame_deltas),
            "frame_abs_max": _max_abs(frame_deltas),
        },
        "inference_wall_time": evaluations[0]["prefix_run_summary"]
        if evaluations
        else None,
    }


def _evaluation_key(evaluation: dict[str, object]) -> tuple[str, str]:
    source = evaluation["source_identity"]["source_recording_id"]
    return str(source), str(evaluation["case_id"])


def _metrics_for(evaluations: list[dict[str, object]]) -> dict[str, object]:
    by_kind: dict[str, list[dict[str, object]]] = defaultdict(list)
    for evaluation in evaluations:
        by_kind[str(evaluation["case_kind"])].append(evaluation)
    return {
        "correct_single": _rate(by_kind["correct_strike"]),
        "correct_chord": _rate(by_kind["correct_chord"]),
        "retrigger": _rate(by_kind["same_note_retrigger"]),
        "clean_negative_false": _rate(
            evaluation
            for kind in ("wrong_semitone", "wrong_octave", "missing_chord_tone")
            for evaluation in by_kind[kind]
            if not bool(evaluation["future_target_contaminated"])
        ),
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
    }


def _rate(evaluations: object) -> dict[str, object]:
    items = tuple(evaluations)
    accepted = sum(1 for evaluation in items if bool(evaluation["accepted"]))
    total = len(items)
    return {
        "accepted": accepted,
        "total": total,
        "rate": round(accepted / total, 6) if total else None,
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


def _validate_policy(policy_artifact: dict[str, object]) -> None:
    if policy_artifact.get("status") != "frozen_before_evaluation":
        raise ValueError("policy artifact must be frozen_before_evaluation")
    policy = policy_artifact.get("policy") or {}
    if policy.get("frame_key") != "frame_activation":
        raise ValueError("future-context experiment only supports frame_activation")
    if policy.get("competitor_margins_enabled") is not False:
        raise ValueError("competitor margins must be disabled")
    if policy.get("chord_timing_spread_enabled") is not False:
        raise ValueError("chord timing spread must be disabled")


def _checkpoint_path(frontend: dict[str, object]) -> Path:
    configured = frontend.get("checkpoint_path")
    if configured:
        return Path(str(configured))
    if frontend.get("model_id") == "CRNN_note_F1_0.9677_pedal_F1_0.9186":
        return Path("/app/models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth")
    raise ValueError("policy artifact must provide a supported checkpoint identity")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_float(value: float) -> str:
    return str(round(value, 4)).replace(".", "p")


if __name__ == "__main__":
    raise SystemExit(main())
