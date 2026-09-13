"""Evaluate RTT causal onset candidates handed off to ByteDance verifier.

This research-only benchmark keeps the runtime responsibilities separated:

* RTT receives only sequential 16 kHz mono PCM for each case clip and emits
  candidate timestamps.
* Offline scoring later compares those candidates with MIDI-derived ground
  truth.
* ByteDance receives only a compatible candidate timestamp, the expected pitch
  set, and PCM through candidate +220ms.

No frozen evaluation set is used, no thresholds are tuned, and no production
recognition/progression code is modified.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
import statistics
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
from evaluate_rtt_causal_frontend import (
    SAMPLE_RATE,
    _candidate_strikes,
    _ground_truth_strike_groups,
    _prepare_rtt_imports,
    _predict_rtt_raw,
)


TARGET_ANCHOR_SECONDS = 1.6
REAL_LOOKBACK_SECONDS = 1.0
FUTURE_SECONDS = 0.22
HANDOFF_MIN_DELTA_SECONDS = -0.120
HANDOFF_MAX_DELTA_SECONDS = 0.050
NO_RETRIGGER_CASE_KINDS = {
    "long_held_note_without_retrigger",
    "pedal_sustain_tail_without_retrigger",
}
TARGET_LOCAL_CASE_KINDS = {
    "correct_strike",
    "correct_chord",
    "wrong_semitone",
    "wrong_octave",
    "missing_chord_tone",
}
POSITIVE_CASE_KINDS = {"correct_strike", "correct_chord", "same_note_retrigger"}
NEGATIVE_CASE_KINDS = {"wrong_semitone", "wrong_octave", "missing_chord_tone"}


def main() -> int:
    args = parse_args()
    _prepare_rtt_imports(args.rtt_repo)
    import torch

    from models import CustomAMT
    from pl_model import RTT

    policy_artifact = json.loads(args.policy.read_text(encoding="utf-8"))
    _validate_policy(policy_artifact)
    policy = policy_artifact["policy"]
    window = policy_artifact["benchmark_window"]
    frontend = policy_artifact["frontend"]
    checkpoint_path = _checkpoint_path(frontend)
    checkpoint_sha256 = _sha256(checkpoint_path)
    if checkpoint_sha256 != frontend["checkpoint_sha256"]:
        raise ValueError(
            "ByteDance checkpoint SHA256 mismatch: "
            f"expected {frontend['checkpoint_sha256']}, got {checkpoint_sha256}"
        )

    rtt_device = torch.device(args.rtt_device)
    rtt_model = CustomAMT()
    rtt_checkpoint = RTT.load_from_checkpoint(
        model=rtt_model,
        loss_function="weighted_bce_mse",
        checkpoint_path=str(args.rtt_checkpoint),
        map_location=rtt_device,
    )
    rtt_model = rtt_checkpoint.model.to(rtt_device).eval()

    bytedance_provider = ByteDancePianoTranscriptionProvider(
        checkpoint_path=checkpoint_path,
        device=args.bytedance_device,
    )
    _warm_up_note_model(bytedance_provider, device=args.bytedance_device)

    cases = [
        (manifest_path, case)
        for manifest_path in args.case_manifest
        for case in json.loads(manifest_path.read_text(encoding="utf-8")).get("cases", ())
    ]
    evaluations = [
        _evaluate_case(
            manifest_path,
            case,
            rtt_model=rtt_model,
            rtt_device=rtt_device,
            bytedance_provider=bytedance_provider,
            bytedance_device=args.bytedance_device,
            work_dir=args.work_dir,
            local_pre_seconds=float(window["local_pre_seconds"]),
            local_post_seconds=float(window["local_post_seconds"]),
            onset_threshold=float(policy["target_onset_min"]),
            frame_threshold=float(policy["target_frame_min"]),
        )
        for manifest_path, case in cases
    ]

    report = {
        "benchmark_scope": "rtt_candidate_to_bytedance_bounded_verifier_dev_cal",
        "scope_wording": (
            "candidate-handoff research only; this is not a complete STEP "
            "progression/state-machine benchmark because case pre-context does "
            "not contain full score-state history."
        ),
        "constraints": {
            "frozen_evaluation_used": False,
            "production_modified": False,
            "rtt_threshold_tuning": False,
            "bytedance_threshold_tuning": False,
            "parpiano_tested": False,
            "browser_export": False,
            "full_step_state_machine_simulation": False,
        },
        "runtime_separation": {
            "rtt_runtime_inputs": ["sequential 16 kHz mono PCM case clip"],
            "rtt_runtime_forbidden": [
                "MIDI",
                "target timestamp",
                "expected pitch",
                "case kind",
                "future beyond current PCM",
            ],
            "bytedance_runtime_inputs": [
                "candidate timestamp",
                "expected pitch set",
                "PCM available through candidate +220ms",
            ],
        },
        "rtt": {
            "repo": "https://github.com/huispaty/rtt",
            "repo_commit": args.rtt_commit,
            "checkpoint_path": str(args.rtt_checkpoint),
            "input_scale": "official_float",
        },
        "bytedance": {
            "provider": frontend["provider"],
            "checkpoint_sha256": checkpoint_sha256,
            "policy": {
                "onset": float(policy["target_onset_min"]),
                "frame": float(policy["target_frame_min"]),
                "frame_key": policy["frame_key"],
                "competitor_margins_enabled": False,
                "chord_timing_spread_enabled": False,
            },
            "candidate_anchor_contract": {
                "sample_rate_hz": SAMPLE_RATE,
                "max_real_lookback_ms": int(REAL_LOOKBACK_SECONDS * 1000),
                "target_anchor_ms": int(TARGET_ANCHOR_SECONDS * 1000),
                "future_ms": int(FUTURE_SECONDS * 1000),
                "local_evidence_ms": [
                    int(-float(window["local_pre_seconds"]) * 1000),
                    int(float(window["local_post_seconds"]) * 1000),
                ],
            },
        },
        "handoff_scoring": {
            "target_local_scope": (
                "Oracle target-local handoff diagnostics only for correct_strike, "
                "correct_chord, wrong_semitone, wrong_octave, and missing_chord_tone."
            ),
            "compatible_delta_ms": [
                int(HANDOFF_MIN_DELTA_SECONDS * 1000),
                int(HANDOFF_MAX_DELTA_SECONDS * 1000),
            ],
            "candidate_delta_definition": "candidate_time - GT_strike_time",
            "same_note_retrigger_scope": (
                "Sequential replay: first group consumes chronological RTT candidates "
                "until MATCH; second group can only consume candidates at or after "
                "first_candidate_time + 220ms."
            ),
            "no_retrigger_scope": (
                "Sequential replay: first group consumes chronological RTT candidates "
                "until MATCH; second group consumes every later RTT candidate from "
                "first decision time to clip end. No synthetic second target timestamp "
                "is created."
            ),
        },
        "case_manifests": [str(path) for path in args.case_manifest],
        "case_count": len(cases),
        "summary": _summary(evaluations),
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
    parser.add_argument("--rtt-checkpoint", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--rtt-device", default="cpu")
    parser.add_argument("--bytedance-device", default="cuda")
    return parser.parse_args()


def _evaluate_case(
    manifest_path: Path,
    case: dict[str, object],
    *,
    rtt_model: object,
    rtt_device: object,
    bytedance_provider: ByteDancePianoTranscriptionProvider,
    bytedance_device: str,
    work_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[str, object]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE}Hz case audio, got {sample_rate}")

    rtt_output, rtt_latency = _predict_rtt_raw(
        rtt_model,
        audio,
        device=rtt_device,
        input_scale="official_float",
    )
    candidates = _candidate_strikes(rtt_output["onset_output"], rtt_output["frame_output"])
    source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
    source_end = float(
        (case.get("source_time_range_seconds") or (source_start, source_start + audio.size / sample_rate))[1]
    )
    gt_groups = _ground_truth_strike_groups(
        case,
        source_start_seconds=source_start,
        source_end_seconds=source_end,
    )
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
    target_absolute_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    target_relative_seconds = tuple(value - source_start for value in target_absolute_seconds)

    bytedance_latencies = []
    verifier_cache: dict[tuple[int, tuple[str, ...]], dict[str, object]] = {}
    case_kind = str(case.get("case_kind"))
    if case_kind in TARGET_LOCAL_CASE_KINDS:
        group_results = _evaluate_target_local_groups(
            manifest_path,
            case,
            audio,
            sample_rate,
            candidates=candidates,
            source_start=source_start,
            expected_groups=expected_groups,
            actual_groups=actual_groups,
            target_relative_seconds=target_relative_seconds,
            target_absolute_seconds=target_absolute_seconds,
            provider=bytedance_provider,
            device=bytedance_device,
            work_dir=work_dir,
            local_pre_seconds=local_pre_seconds,
            local_post_seconds=local_post_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            verifier_cache=verifier_cache,
            latency_sink=bytedance_latencies,
        )
        matched_groups = sum(1 for group in group_results if group["combined_match"])
        evaluation_mode = "oracle_target_local"
    elif case_kind == "same_note_retrigger":
        group_results = _evaluate_same_note_retrigger_sequential(
            manifest_path,
            case,
            audio,
            sample_rate,
            candidates=candidates,
            source_start=source_start,
            expected_groups=expected_groups,
            actual_groups=actual_groups,
            target_relative_seconds=target_relative_seconds,
            target_absolute_seconds=target_absolute_seconds,
            provider=bytedance_provider,
            device=bytedance_device,
            work_dir=work_dir,
            local_pre_seconds=local_pre_seconds,
            local_post_seconds=local_post_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            verifier_cache=verifier_cache,
            latency_sink=bytedance_latencies,
        )
        matched_groups = sum(1 for group in group_results if group["combined_match"])
        evaluation_mode = "sequential_same_note_retrigger"
    elif case_kind in NO_RETRIGGER_CASE_KINDS:
        group_results = _evaluate_no_retrigger_sequential(
            manifest_path,
            case,
            audio,
            sample_rate,
            candidates=candidates,
            source_start=source_start,
            expected_groups=expected_groups,
            actual_groups=actual_groups,
            target_relative_seconds=target_relative_seconds,
            target_absolute_seconds=target_absolute_seconds,
            provider=bytedance_provider,
            device=bytedance_device,
            work_dir=work_dir,
            local_pre_seconds=local_pre_seconds,
            local_post_seconds=local_post_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            verifier_cache=verifier_cache,
            latency_sink=bytedance_latencies,
        )
        matched_groups = sum(1 for group in group_results if group["combined_match"])
        evaluation_mode = "sequential_no_retrigger"
    else:
        raise ValueError(f"Unsupported case kind for RTT handoff benchmark: {case_kind}")

    expected_advances = int(case.get("expected_advances", 0))
    matched_groups = sum(1 for group in group_results if group["combined_match"])
    accepted = matched_groups > 0 if expected_advances == 0 else matched_groups >= expected_advances
    duration_seconds = audio.size / sample_rate
    return {
        "case_id": case.get("case_id"),
        "case_kind": case_kind,
        "evaluation_mode": evaluation_mode,
        "expected_advances": expected_advances,
        "matched_groups": matched_groups,
        "accepted": accepted,
        "future_target_contaminated": any(
            group["future_target_contamination"]["contaminated"] for group in group_results
        ),
        "source_identity": _case_source_identity(case),
        "timeline": {
            "source_start_seconds": source_start,
            "source_end_seconds": source_end,
            "case_wav_duration_seconds": round(duration_seconds, 6),
            "timeline": "clip_relative_seconds",
        },
        "gt_strike_groups": gt_groups,
        "rtt_candidate_strikes": candidates,
        "group_results": group_results,
        "candidate_pressure": _candidate_pressure(
            candidates,
            gt_groups,
            group_results,
            duration_seconds=duration_seconds,
        ),
        "latency": {
            "rtt_full_clip": rtt_latency,
            "bytedance_candidate_verifier": bytedance_latencies,
        },
    }


def _evaluate_target_local_groups(
    manifest_path: Path,
    case: dict[str, object],
    audio: np.ndarray,
    sample_rate: int,
    *,
    candidates: list[dict[str, object]],
    source_start: float,
    expected_groups: tuple[tuple[str, ...], ...],
    actual_groups: tuple[tuple[str, ...], ...],
    target_relative_seconds: tuple[float, ...],
    target_absolute_seconds: tuple[float, ...],
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    work_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    verifier_cache: dict[tuple[int, tuple[str, ...]], dict[str, object]],
    latency_sink: list[dict[str, object]],
) -> list[dict[str, object]]:
    if len(target_relative_seconds) < len(expected_groups):
        raise ValueError(
            f"{case.get('case_id')} is target-local but has fewer target timestamps "
            f"({len(target_relative_seconds)}) than expected groups ({len(expected_groups)})"
        )
    group_results = []
    for group_index, expected_pitches in enumerate(expected_groups):
        target_relative = float(target_relative_seconds[group_index])
        target_absolute = float(target_absolute_seconds[group_index])
        actual_pitches = actual_groups[group_index] if group_index < len(actual_groups) else ()
        compatible_candidates = _compatible_candidates(candidates, target_relative)
        candidate_results = _verify_candidates(
            manifest_path,
            case,
            audio,
            sample_rate,
            source_start_seconds=source_start,
            candidates=compatible_candidates,
            expected_pitches=expected_pitches,
            provider=provider,
            device=device,
            work_dir=work_dir,
            local_pre_seconds=local_pre_seconds,
            local_post_seconds=local_post_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            verifier_cache=verifier_cache,
            latency_sink=latency_sink,
        )
        group_results.append(
            _group_result(
                case,
                mode="oracle_target_local",
                group_index=group_index,
                expected_pitches=expected_pitches,
                actual_pitches=actual_pitches,
                target_relative=target_relative,
                target_absolute=target_absolute,
                candidate_pairs=compatible_candidates,
                candidate_results=candidate_results,
                contamination_decision_end=target_absolute + FUTURE_SECONDS,
            )
        )
    return group_results


def _evaluate_same_note_retrigger_sequential(
    manifest_path: Path,
    case: dict[str, object],
    audio: np.ndarray,
    sample_rate: int,
    *,
    candidates: list[dict[str, object]],
    source_start: float,
    expected_groups: tuple[tuple[str, ...], ...],
    actual_groups: tuple[tuple[str, ...], ...],
    target_relative_seconds: tuple[float, ...],
    target_absolute_seconds: tuple[float, ...],
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    work_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    verifier_cache: dict[tuple[int, tuple[str, ...]], dict[str, object]],
    latency_sink: list[dict[str, object]],
) -> list[dict[str, object]]:
    if len(expected_groups) < 2 or len(target_relative_seconds) < 2:
        raise ValueError(f"{case.get('case_id')} retrigger case requires two real target timestamps")

    first_target_relative = float(target_relative_seconds[0])
    second_target_relative = float(target_relative_seconds[1])
    first_pairs = _compatible_candidates(candidates, first_target_relative)
    first_results = _verify_until_match(
        manifest_path,
        case,
        audio,
        sample_rate,
        source_start_seconds=source_start,
        candidate_pairs=first_pairs,
        expected_pitches=expected_groups[0],
        provider=provider,
        device=device,
        work_dir=work_dir,
        local_pre_seconds=local_pre_seconds,
        local_post_seconds=local_post_seconds,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        verifier_cache=verifier_cache,
        latency_sink=latency_sink,
    )
    first_match = _first_match(first_results)
    first_group = _group_result(
        case,
        mode="sequential_first_advance",
        group_index=0,
        expected_pitches=expected_groups[0],
        actual_pitches=actual_groups[0] if actual_groups else (),
        target_relative=first_target_relative,
        target_absolute=float(target_absolute_seconds[0]),
        candidate_pairs=[(int(result["candidate_index"]), {"anchor_second": result["candidate_second"]}) for result in first_results],
        candidate_results=first_results,
        contamination_decision_end=float(target_absolute_seconds[0]) + FUTURE_SECONDS,
    )
    first_group["first_advance_success"] = bool(first_match)
    if first_match is None:
        second_pairs: list[tuple[int, dict[str, object]]] = []
        second_results: list[dict[str, object]] = []
        step2_activation_time = None
    else:
        step2_activation_time = float(first_match["candidate_second"]) + FUTURE_SECONDS
        second_pairs = [
            (index, candidate)
            for index, candidate in enumerate(candidates)
            if float(candidate["anchor_second"]) >= step2_activation_time
        ]
        second_results = _verify_until_match(
            manifest_path,
            case,
            audio,
            sample_rate,
            source_start_seconds=source_start,
            candidate_pairs=second_pairs,
            expected_pitches=expected_groups[1],
            provider=provider,
            device=device,
            work_dir=work_dir,
            local_pre_seconds=local_pre_seconds,
            local_post_seconds=local_post_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            verifier_cache=verifier_cache,
            latency_sink=latency_sink,
        )
    second_match = _first_match(second_results)
    second_advance_class = "NO_SECOND_MATCH"
    second_match_delta_ms = None
    if second_match is not None:
        second_match_delta_ms = round(
            (float(second_match["candidate_second"]) - second_target_relative) * 1000.0,
            3,
        )
        if second_match_delta_ms < HANDOFF_MIN_DELTA_SECONDS * 1000.0:
            second_advance_class = "PREMATURE_FALSE_ADVANCE"
        elif second_match_delta_ms <= HANDOFF_MAX_DELTA_SECONDS * 1000.0:
            second_advance_class = "LEGITIMATE_RETRIGGER_ADVANCE"
        else:
            second_advance_class = "LATE_OR_STALE_MATCH"
    second_group = _group_result(
        case,
        mode="sequential_second_retrigger",
        group_index=1,
        expected_pitches=expected_groups[1],
        actual_pitches=actual_groups[1] if len(actual_groups) > 1 else (),
        target_relative=second_target_relative,
        target_absolute=float(target_absolute_seconds[1]),
        candidate_pairs=second_pairs,
        candidate_results=second_results,
        contamination_decision_end=float(target_absolute_seconds[1]) + FUTURE_SECONDS,
    )
    second_group.update(
        {
            "step2_activation_time": round(step2_activation_time, 6) if step2_activation_time is not None else None,
            "first_advance_established": bool(first_match),
            "second_retrigger_advance_success": bool(second_match),
            "second_advance_class": second_advance_class,
            "second_match_delta_ms": second_match_delta_ms,
            "premature_second_advance_before_real_retrigger": (
                second_advance_class == "PREMATURE_FALSE_ADVANCE"
            ),
            "second_match_candidate_second": (
                round(float(second_match["candidate_second"]), 6) if second_match is not None else None
            ),
            "second_match_decision_second": (
                round(float(second_match["candidate_second"]) + FUTURE_SECONDS, 6)
                if second_match is not None
                else None
            ),
        }
    )
    return [first_group, second_group]


def _evaluate_no_retrigger_sequential(
    manifest_path: Path,
    case: dict[str, object],
    audio: np.ndarray,
    sample_rate: int,
    *,
    candidates: list[dict[str, object]],
    source_start: float,
    expected_groups: tuple[tuple[str, ...], ...],
    actual_groups: tuple[tuple[str, ...], ...],
    target_relative_seconds: tuple[float, ...],
    target_absolute_seconds: tuple[float, ...],
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    work_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    verifier_cache: dict[tuple[int, tuple[str, ...]], dict[str, object]],
    latency_sink: list[dict[str, object]],
) -> list[dict[str, object]]:
    if len(expected_groups) < 2 or len(target_relative_seconds) != 1:
        raise ValueError(
            f"{case.get('case_id')} no-retrigger case must have two expected groups "
            "and exactly one real target timestamp"
        )
    first_target_relative = float(target_relative_seconds[0])
    first_pairs = _compatible_candidates(candidates, first_target_relative)
    first_results = _verify_until_match(
        manifest_path,
        case,
        audio,
        sample_rate,
        source_start_seconds=source_start,
        candidate_pairs=first_pairs,
        expected_pitches=expected_groups[0],
        provider=provider,
        device=device,
        work_dir=work_dir,
        local_pre_seconds=local_pre_seconds,
        local_post_seconds=local_post_seconds,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        verifier_cache=verifier_cache,
        latency_sink=latency_sink,
    )
    first_match = _first_match(first_results)
    first_group = _group_result(
        case,
        mode="sequential_first_advance",
        group_index=0,
        expected_pitches=expected_groups[0],
        actual_pitches=actual_groups[0] if actual_groups else (),
        target_relative=first_target_relative,
        target_absolute=float(target_absolute_seconds[0]),
        candidate_pairs=[(int(result["candidate_index"]), {"anchor_second": result["candidate_second"]}) for result in first_results],
        candidate_results=first_results,
        contamination_decision_end=float(target_absolute_seconds[0]) + FUTURE_SECONDS,
    )
    first_group["first_advance_success"] = bool(first_match)
    if first_match is None:
        post_advance_pairs: list[tuple[int, dict[str, object]]] = []
        post_advance_results: list[dict[str, object]] = []
        first_decision_time = None
    else:
        first_decision_time = float(first_match["candidate_second"]) + FUTURE_SECONDS
        post_advance_pairs = [
            (index, candidate)
            for index, candidate in enumerate(candidates)
            if float(candidate["anchor_second"]) >= first_decision_time
        ]
        post_advance_results = _verify_until_match(
            manifest_path,
            case,
            audio,
            sample_rate,
            source_start_seconds=source_start,
            candidate_pairs=post_advance_pairs,
            expected_pitches=expected_groups[1],
            provider=provider,
            device=device,
            work_dir=work_dir,
            local_pre_seconds=local_pre_seconds,
            local_post_seconds=local_post_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            verifier_cache=verifier_cache,
            latency_sink=latency_sink,
        )
    false_match = _first_match(post_advance_results)
    second_group = _group_result(
        case,
        mode="sequential_no_retrigger_post_advance",
        group_index=1,
        expected_pitches=expected_groups[1],
        actual_pitches=actual_groups[1] if len(actual_groups) > 1 else (),
        target_relative=None,
        target_absolute=None,
        candidate_pairs=post_advance_pairs,
        candidate_results=post_advance_results,
        contamination_decision_end=None,
    )
    second_group.update(
        {
            "synthetic_target_used": False,
            "first_advance_established": bool(first_match),
            "first_decision_time": round(first_decision_time, 6) if first_decision_time is not None else None,
            "post_advance_candidate_count": len(post_advance_pairs),
            "post_advance_bytedance_calls": len(post_advance_results),
            "false_second_match": bool(false_match),
            "time_from_first_decision_to_false_match_ms": (
                round((float(false_match["candidate_second"]) + FUTURE_SECONDS - float(first_decision_time)) * 1000.0, 3)
                if false_match is not None and first_decision_time is not None
                else None
            ),
        }
    )
    return [first_group, second_group]


def _verify_until_match(
    manifest_path: Path,
    case: dict[str, object],
    audio: np.ndarray,
    sample_rate: int,
    *,
    source_start_seconds: float,
    candidate_pairs: list[tuple[int, dict[str, object]]],
    expected_pitches: tuple[str, ...],
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    work_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    verifier_cache: dict[tuple[int, tuple[str, ...]], dict[str, object]],
    latency_sink: list[dict[str, object]],
) -> list[dict[str, object]]:
    results = []
    for candidate_index, candidate in candidate_pairs:
        result = _verify_candidates(
            manifest_path,
            case,
            audio,
            sample_rate,
            source_start_seconds=source_start_seconds,
            candidates=[(candidate_index, candidate)],
            expected_pitches=expected_pitches,
            provider=provider,
            device=device,
            work_dir=work_dir,
            local_pre_seconds=local_pre_seconds,
            local_post_seconds=local_post_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            verifier_cache=verifier_cache,
            latency_sink=latency_sink,
        )[0]
        results.append(result)
        if result["result"] == "MATCH":
            break
    return results


def _verify_candidates(
    manifest_path: Path,
    case: dict[str, object],
    audio: np.ndarray,
    sample_rate: int,
    *,
    source_start_seconds: float,
    candidates: list[tuple[int, dict[str, object]]],
    expected_pitches: tuple[str, ...],
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    work_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    verifier_cache: dict[tuple[int, tuple[str, ...]], dict[str, object]],
    latency_sink: list[dict[str, object]],
) -> list[dict[str, object]]:
    results = []
    for candidate_index, candidate in candidates:
        cache_key = (candidate_index, tuple(expected_pitches))
        if cache_key not in verifier_cache:
            verifier_cache[cache_key] = _verify_candidate(
                manifest_path,
                case,
                audio,
                sample_rate,
                source_start_seconds=source_start_seconds,
                candidate_index=candidate_index,
                candidate=candidate,
                expected_pitches=expected_pitches,
                provider=provider,
                device=device,
                work_dir=work_dir,
                local_pre_seconds=local_pre_seconds,
                local_post_seconds=local_post_seconds,
                onset_threshold=onset_threshold,
                frame_threshold=frame_threshold,
            )
            if verifier_cache[cache_key].get("latency"):
                latency_sink.append(verifier_cache[cache_key]["latency"])
        results.append(verifier_cache[cache_key])
    return results


def _group_result(
    case: dict[str, object],
    *,
    mode: str,
    group_index: int,
    expected_pitches: tuple[str, ...],
    actual_pitches: tuple[str, ...],
    target_relative: float | None,
    target_absolute: float | None,
    candidate_pairs: list[tuple[int, dict[str, object]]],
    candidate_results: list[dict[str, object]],
    contamination_decision_end: float | None,
) -> dict[str, object]:
    matched_candidates = [item for item in candidate_results if item["result"] == "MATCH"]
    contamination = (
        _future_target_contamination(
            case,
            expected_pitches=expected_pitches,
            actual_pitches=actual_pitches,
            target_second=target_absolute,
            decision_end_seconds=contamination_decision_end,
        )
        if target_absolute is not None and contamination_decision_end is not None
        else {"contaminated": False, "actual_target_pitches": list(actual_pitches), "counterfactual_pitches": [], "events": []}
    )
    return {
        "mode": mode,
        "group_index": group_index,
        "target_second": round(target_relative, 6) if target_relative is not None else None,
        "target_absolute_second": round(target_absolute, 6) if target_absolute is not None else None,
        "expected_pitches": expected_pitches,
        "actual_pitches_at_target": actual_pitches,
        "candidate_count": len(candidate_pairs),
        "candidate_deltas_ms": (
            [
                round((float(candidate["anchor_second"]) - float(target_relative)) * 1000.0, 3)
                for _, candidate in candidate_pairs
            ]
            if target_relative is not None
            else []
        ),
        "handoff_compatible": bool(candidate_pairs),
        "candidate_results": candidate_results,
        "combined_result": "MATCH" if matched_candidates else "NO_MATCH",
        "combined_match": bool(matched_candidates),
        "future_target_contamination": contamination,
    }


def _first_match(candidate_results: list[dict[str, object]]) -> dict[str, object] | None:
    for result in candidate_results:
        if result["result"] == "MATCH":
            return result
    return None


def _compatible_candidates(
    candidates: list[dict[str, object]],
    target_second: float,
) -> list[tuple[int, dict[str, object]]]:
    compatible = []
    for index, candidate in enumerate(candidates):
        delta = float(candidate["anchor_second"]) - target_second
        if HANDOFF_MIN_DELTA_SECONDS <= delta <= HANDOFF_MAX_DELTA_SECONDS:
            compatible.append((index, candidate))
    return compatible


def _verify_candidate(
    manifest_path: Path,
    case: dict[str, object],
    audio: np.ndarray,
    sample_rate: int,
    *,
    source_start_seconds: float,
    candidate_index: int,
    candidate: dict[str, object],
    expected_pitches: tuple[str, ...],
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    work_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[str, object]:
    del manifest_path
    candidate_relative_second = float(candidate["anchor_second"])
    candidate_absolute_second = source_start_seconds + candidate_relative_second
    audio_duration_seconds = audio.size / sample_rate
    required_end_second = candidate_relative_second + FUTURE_SECONDS
    if required_end_second > audio_duration_seconds + 1e-9:
        return {
            "candidate_index": candidate_index,
            "candidate_second": round(candidate_relative_second, 6),
            "status": "INSUFFICIENT_FUTURE_AUDIO",
            "future_available_ms": round(
                max(0.0, audio_duration_seconds - candidate_relative_second) * 1000.0,
                3,
            ),
            "result": "UNCERTAIN",
        }

    available_real_lookback_seconds = min(REAL_LOOKBACK_SECONDS, candidate_relative_second)
    real_start_relative = candidate_relative_second - available_real_lookback_seconds
    real_end_relative = required_end_second
    real_audio = audio[
        int(round(real_start_relative * sample_rate)) : int(round(real_end_relative * sample_rate))
    ]
    zero_pad_seconds = TARGET_ANCHOR_SECONDS - available_real_lookback_seconds
    zero_pad = np.zeros(int(round(zero_pad_seconds * sample_rate)), dtype=real_audio.dtype)
    clip_audio = np.concatenate([zero_pad, real_audio])
    expected_samples = int(round((TARGET_ANCHOR_SECONDS + FUTURE_SECONDS) * sample_rate))
    if clip_audio.size != expected_samples:
        raise ValueError(
            f"candidate tensor sample count mismatch for {case.get('case_id')}: "
            f"got {clip_audio.size}, expected {expected_samples}"
        )

    safe_case_id = str(case["case_id"]).replace("/", "_")
    clip_path = (
        work_dir
        / "candidate_anchor_clips"
        / f"{safe_case_id}_c{candidate_index:03d}_{int(round(candidate_relative_second * 1000))}ms.wav"
    )
    _write_wav(clip_path, clip_audio, sample_rate=sample_rate)
    clip_start_seconds = candidate_absolute_second - TARGET_ANCHOR_SECONDS
    started = perf_counter()
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
        analysis_start_seconds=candidate_absolute_second - local_pre_seconds,
        analysis_end_seconds=candidate_absolute_second + local_post_seconds,
        target_second=candidate_absolute_second,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
    )
    end_to_end_ms = (perf_counter() - started) * 1000.0
    observed = tuple(
        pitch
        for pitch, evidence in prediction["expected_evidence"].items()
        if evidence["accepted"]
    )
    result, matched, missing, extra = _evaluate_expected(expected_pitches, observed)
    return {
        "candidate_index": candidate_index,
        "candidate_second": round(candidate_relative_second, 6),
        "candidate_absolute_second": round(candidate_absolute_second, 6),
        "rtt_candidate_pitches": candidate.get("pitches", ()),
        "status": "VERIFIED",
        "observed_pitches": observed,
        "result": result,
        "matched_expected": matched,
        "missing_expected": missing,
        "extra_observed": extra,
        "expected_evidence": prediction["expected_evidence"],
        "chord_summary": prediction["chord_summary"],
        "fixed_anchor_window": {
            "target_anchor_ms": int(TARGET_ANCHOR_SECONDS * 1000),
            "available_real_lookback_ms": round(available_real_lookback_seconds * 1000.0, 3),
            "zero_pad_ms": round(zero_pad_seconds * 1000.0, 3),
            "future_available_ms": round(FUTURE_SECONDS * 1000.0, 3),
            "tensor_duration_ms": round((clip_audio.size / sample_rate) * 1000.0, 3),
        },
        "latency": {
            "forward_ms": round(float(forward_latency["forward_ms"]), 3),
            "target_evidence_end_to_end_ms": round(end_to_end_ms, 3),
            "estimated_candidate_to_decision_ms": round(FUTURE_SECONDS * 1000.0 + end_to_end_ms, 3),
        },
    }


def _candidate_pressure(
    candidates: list[dict[str, object]],
    gt_groups: list[dict[str, object]],
    group_results: list[dict[str, object]],
    *,
    duration_seconds: float,
) -> dict[str, object]:
    verifier_calls = sum(len(group["candidate_results"]) for group in group_results)
    oracle_target_local_calls = sum(
        len(group["candidate_results"])
        for group in group_results
        if group.get("mode") == "oracle_target_local"
    )
    sequential_first_calls = sum(
        len(group["candidate_results"])
        for group in group_results
        if group.get("mode") == "sequential_first_advance"
    )
    sequential_post_advance_calls = sum(
        len(group["candidate_results"])
        for group in group_results
        if group.get("mode")
        in {"sequential_second_retrigger", "sequential_no_retrigger_post_advance"}
    )
    duplicates = 0
    for group in gt_groups:
        gt_time = float(group["anchor_second"])
        near_count = sum(
            1
            for candidate in candidates
            if HANDOFF_MIN_DELTA_SECONDS
            <= float(candidate["anchor_second"]) - gt_time
            <= HANDOFF_MAX_DELTA_SECONDS
        )
        duplicates += max(0, near_count - 1)
    minutes = max(duration_seconds / 60.0, 1e-9)
    return {
        "rtt_candidates": len(candidates),
        "rtt_candidates_per_minute": round(len(candidates) / minutes, 6),
        "bytedance_verifier_calls": verifier_calls,
        "bytedance_verifier_calls_per_minute": round(verifier_calls / minutes, 6),
        "oracle_target_local_verifier_calls": oracle_target_local_calls,
        "oracle_target_local_verifier_calls_per_minute": round(
            oracle_target_local_calls / minutes,
            6,
        ),
        "sequential_first_advance_verifier_calls": sequential_first_calls,
        "sequential_first_advance_verifier_calls_per_minute": round(
            sequential_first_calls / minutes,
            6,
        ),
        "sequential_post_advance_verifier_calls": sequential_post_advance_calls,
        "sequential_post_advance_verifier_calls_per_minute": round(
            sequential_post_advance_calls / minutes,
            6,
        ),
        "duplicate_calls": duplicates,
        "duplicate_calls_per_physical_strike": (
            round(duplicates / len(gt_groups), 6) if gt_groups else None
        ),
    }


def _summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return {
        "handoff_compatible_target_recall": _handoff_summary(evaluations),
        "combined_rtt_to_bytedance": _combined_summary(evaluations),
        "safety": _safety_summary(evaluations),
        "candidate_pressure": _pressure_summary(evaluations),
        "latency": _latency_summary(evaluations),
        "per_source": _per_source_summary(evaluations),
        "stop_rule_assessment": _stop_rule_assessment(evaluations),
    }


def _handoff_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    target_local_positive = [
        item for item in evaluations if str(item["case_kind"]) in {"correct_strike", "correct_chord"}
    ]
    target_local_negative = [
        item for item in evaluations if str(item["case_kind"]) in NEGATIVE_CASE_KINDS
    ]
    return {
        "scope": "oracle target-local handoff diagnostics; excludes same-note retrigger sequential replay",
        "target_local_positive_targets": _target_rate(target_local_positive, "handoff_compatible"),
        "correct_single": _target_rate(_by_kind(evaluations, "correct_strike"), "handoff_compatible"),
        "correct_chord": _target_rate(_by_kind(evaluations, "correct_chord"), "handoff_compatible"),
        "target_local_negative_targets": _target_rate(target_local_negative, "handoff_compatible"),
        "candidate_delta_ms": _distribution(
            [
                float(delta)
                for evaluation in evaluations
                if str(evaluation["case_kind"]) in TARGET_LOCAL_CASE_KINDS
                for group in evaluation["group_results"]
                for delta in group["candidate_deltas_ms"]
            ]
        ),
    }


def _combined_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return {
        "correct_single": _case_rate(_by_kind(evaluations, "correct_strike")),
        "correct_chord": _case_rate(_by_kind(evaluations, "correct_chord")),
        "retrigger": _case_rate(_by_kind(evaluations, "same_note_retrigger")),
        "same_note_retrigger_sequential": _same_note_retrigger_summary(
            _by_kind(evaluations, "same_note_retrigger")
        ),
        "positive_overall": _case_rate(
            [item for item in evaluations if str(item["case_kind"]) in POSITIVE_CASE_KINDS]
        ),
    }


def _safety_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    wrong_semitone = _clean_negative_rate(evaluations, "wrong_semitone")
    wrong_octave = _clean_negative_rate(evaluations, "wrong_octave")
    missing = _clean_negative_rate(evaluations, "missing_chord_tone")
    no_retrigger = {
        kind: {
            "cases": len(_by_kind(evaluations, kind)),
            "first_advance_established": _no_retrigger_first_established_rate(
                _by_kind(evaluations, kind)
            ),
            "no_strike_target_with_rtt_candidate": _no_retrigger_group_rate(
                _by_kind(evaluations, kind),
                key="handoff_compatible",
            ),
            "no_strike_bytedance_false_match": _no_retrigger_group_rate(
                _by_kind(evaluations, kind),
                key="combined_match",
            ),
            "details": [
                {
                    "case_id": item["case_id"],
                    "no_strike_groups": [
                        {
                            "group_index": group["group_index"],
                            "candidate_count": group["candidate_count"],
                            "post_advance_bytedance_calls": group.get("post_advance_bytedance_calls"),
                            "combined_match": group["combined_match"],
                            "false_second_match": group.get("false_second_match"),
                            "time_from_first_decision_to_false_match_ms": group.get(
                                "time_from_first_decision_to_false_match_ms"
                            ),
                        }
                        for group in _eligible_no_retrigger_groups(item)
                        if group["candidate_count"] or group["combined_match"]
                    ],
                }
                for item in _by_kind(evaluations, kind)
                if any(
                    group["candidate_count"] or group["combined_match"]
                    for group in _eligible_no_retrigger_groups(item)
                )
            ],
        }
        for kind in sorted(NO_RETRIGGER_CASE_KINDS)
    }
    return {
        "wrong_semitone_clean_false_match": wrong_semitone,
        "wrong_octave_clean_false_match": wrong_octave,
        "missing_chord_tone_clean_false_match": missing,
        "clean_wrong_note_false_match": _clean_negative_rate(evaluations, None),
        "no_retrigger_safety": no_retrigger,
    }


def _pressure_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return {
        "rtt_candidates_per_minute": _distribution(
            [float(item["candidate_pressure"]["rtt_candidates_per_minute"]) for item in evaluations]
        ),
        "bytedance_verifier_calls_per_minute": _distribution(
            [
                float(item["candidate_pressure"]["bytedance_verifier_calls_per_minute"])
                for item in evaluations
            ]
        ),
        "oracle_target_local_verifier_calls_per_minute": _distribution(
            [
                float(item["candidate_pressure"]["oracle_target_local_verifier_calls_per_minute"])
                for item in evaluations
            ]
        ),
        "sequential_first_advance_verifier_calls_per_minute": _distribution(
            [
                float(item["candidate_pressure"]["sequential_first_advance_verifier_calls_per_minute"])
                for item in evaluations
            ]
        ),
        "sequential_post_advance_verifier_calls_per_minute": _distribution(
            [
                float(item["candidate_pressure"]["sequential_post_advance_verifier_calls_per_minute"])
                for item in evaluations
            ]
        ),
        "duplicate_calls_per_physical_strike": _distribution(
            [
                float(item["candidate_pressure"]["duplicate_calls_per_physical_strike"])
                for item in evaluations
                if item["candidate_pressure"]["duplicate_calls_per_physical_strike"] is not None
            ]
        ),
    }


def _latency_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    bytedance = [
        float(latency["target_evidence_end_to_end_ms"])
        for item in evaluations
        for latency in item["latency"]["bytedance_candidate_verifier"]
    ]
    return {
        "rtt_full_clip_compute_ms": _distribution(
            [float(item["latency"]["rtt_full_clip"]["compute_ms"]) for item in evaluations]
        ),
        "bytedance_candidate_target_evidence_ms": _distribution(bytedance),
        "bytedance_candidate_estimated_candidate_to_decision_ms": _distribution(
            [FUTURE_SECONDS * 1000.0 + value for value in bytedance]
        ),
    }


def _per_source_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    by_source: dict[str, list[dict[str, object]]] = defaultdict(list)
    for item in evaluations:
        by_source[str(item["source_identity"]["source_recording_id"])].append(item)
    return {
        source: {
            "handoff": _handoff_summary(items),
            "combined": _combined_summary(items),
            "safety": {
                "clean_wrong_note_false_match": _clean_negative_rate(items, None),
            },
        }
        for source, items in sorted(by_source.items())
    }


def _stop_rule_assessment(evaluations: list[dict[str, object]]) -> dict[str, object]:
    combined = _combined_summary(evaluations)
    safety = _safety_summary(evaluations)
    handoff = _handoff_summary(evaluations)
    retrigger = combined["same_note_retrigger_sequential"]
    candidate_miss_is_bottleneck = (
        handoff["correct_single"]["accepted"] < handoff["correct_single"]["total"]
        or handoff["correct_chord"]["accepted"] < handoff["correct_chord"]["total"]
        or retrigger["first_advance_success"]["accepted"] < retrigger["first_advance_success"]["total"]
        or retrigger["legitimate_second_advance"]["accepted"]
        < retrigger["legitimate_second_advance"]["total"]
    )
    no_retrigger_false = sum(
        int(info["no_strike_bytedance_false_match"]["accepted"])
        for info in safety["no_retrigger_safety"].values()
    )
    clean_false = int(safety["clean_wrong_note_false_match"]["accepted"])
    keep = (
        not candidate_miss_is_bottleneck
        and clean_false <= 1
        and no_retrigger_false == 0
    )
    return {
        "verdict": "KEEP" if keep else "DO_NOT_KEEP_CURRENT_RULE",
        "candidate_miss_is_bottleneck": candidate_miss_is_bottleneck,
        "combined_positive": combined,
        "clean_wrong_note_false_match": safety["clean_wrong_note_false_match"],
        "no_retrigger_false_match_count": no_retrigger_false,
        "note": (
            "This stop-rule assessment is based on candidate handoff research only; "
            "it is not a production STEP progression decision."
        ),
    }


def _target_rate(evaluations: list[dict[str, object]], key: str) -> dict[str, object]:
    groups = [group for item in evaluations for group in item["group_results"]]
    return _fraction(sum(1 for group in groups if bool(group[key])), len(groups))


def _same_note_retrigger_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    first_groups = [
        group
        for item in evaluations
        for group in item["group_results"]
        if group.get("mode") == "sequential_first_advance"
    ]
    second_groups = [
        group
        for item in evaluations
        for group in item["group_results"]
        if group.get("mode") == "sequential_second_retrigger"
    ]
    return {
        "first_advance_success": _fraction(
            sum(1 for group in first_groups if bool(group.get("first_advance_success"))),
            len(first_groups),
        ),
        "legitimate_second_advance": _fraction(
            sum(
                1
                for group in second_groups
                if group.get("second_advance_class") == "LEGITIMATE_RETRIGGER_ADVANCE"
            ),
            len(second_groups),
        ),
        "premature_false_advance": _fraction(
            sum(
                1
                for group in second_groups
                if group.get("second_advance_class") == "PREMATURE_FALSE_ADVANCE"
            ),
            len(second_groups),
        ),
        "late_or_stale_match": _fraction(
            sum(
                1
                for group in second_groups
                if group.get("second_advance_class") == "LATE_OR_STALE_MATCH"
            ),
            len(second_groups),
        ),
        "no_second_match": _fraction(
            sum(
                1
                for group in second_groups
                if group.get("second_advance_class") == "NO_SECOND_MATCH"
            ),
            len(second_groups),
        ),
    }


def _no_retrigger_group_rate(
    evaluations: list[dict[str, object]],
    *,
    key: str,
) -> dict[str, object]:
    groups = [group for item in evaluations for group in _eligible_no_retrigger_groups(item)]
    return _fraction(sum(1 for group in groups if bool(group[key])), len(groups))


def _no_retrigger_first_established_rate(evaluations: list[dict[str, object]]) -> dict[str, object]:
    first_groups = [
        group
        for item in evaluations
        for group in item["group_results"]
        if group.get("mode") == "sequential_first_advance"
    ]
    return _fraction(
        sum(1 for group in first_groups if bool(group.get("first_advance_success"))),
        len(first_groups),
    )


def _eligible_no_retrigger_groups(evaluation: dict[str, object]) -> list[dict[str, object]]:
    return [
        group
        for group in _no_retrigger_groups(evaluation)
        if bool(group.get("first_advance_established"))
    ]


def _no_retrigger_groups(evaluation: dict[str, object]) -> list[dict[str, object]]:
    expected_advances = int(evaluation.get("expected_advances", 0))
    return [
        group
        for group in evaluation["group_results"]
        if int(group["group_index"]) >= expected_advances
    ]


def _case_rate(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return _fraction(sum(1 for item in evaluations if bool(item["accepted"])), len(evaluations))


def _clean_negative_rate(
    evaluations: list[dict[str, object]],
    kind: str | None,
) -> dict[str, object]:
    items = [
        item
        for item in evaluations
        if (kind is None and str(item["case_kind"]) in NEGATIVE_CASE_KINDS)
        or (kind is not None and str(item["case_kind"]) == kind)
    ]
    clean = [item for item in items if not bool(item["future_target_contaminated"])]
    return _case_rate(clean)


def _by_kind(evaluations: list[dict[str, object]], kind: str) -> list[dict[str, object]]:
    return [item for item in evaluations if str(item["case_kind"]) == kind]


def _fraction(hit: int, total: int) -> dict[str, object]:
    return {"accepted": hit, "total": total, "rate": round(hit / total, 6) if total else None}


def _distribution(values: list[float]) -> dict[str, object]:
    if not values:
        return {
            "count": 0,
            "min": None,
            "p05": None,
            "median": None,
            "p95": None,
            "max": None,
            "mean": None,
        }
    ordered = sorted(float(value) for value in values)
    return {
        "count": len(ordered),
        "min": round(ordered[0], 6),
        "p05": round(float(np.percentile(ordered, 5)), 6),
        "median": round(float(statistics.median(ordered)), 6),
        "p95": round(float(np.percentile(ordered, 95)), 6),
        "max": round(ordered[-1], 6),
        "mean": round(float(np.mean(ordered)), 6),
    }


if __name__ == "__main__":
    raise SystemExit(main())
