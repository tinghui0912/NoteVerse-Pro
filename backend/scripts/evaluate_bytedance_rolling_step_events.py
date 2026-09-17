"""Research-only ByteDance rolling onset/frame STEP replay.

This benchmark asks whether ByteDance raw onset/frame evidence can drive STEP
advancement without an external strike timestamp. It uses inspected
development/calibration sources only, keeps the frozen 0.2/0.2 verifier policy,
and does not modify production recognition/progression code.

Runtime inputs for the simulated verifier are limited to:

* 16 kHz mono PCM from the current case clip.
* The current expected pitch group.
* The previous consumed event boundary.

MIDI and target timestamps are used only for offline initialization/scoring.
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
    _case_audio_path,
    _case_source_identity,
    _evaluate_expected,
    _future_target_contamination,
    _read_wav,
)
from evaluate_bytedance_direct_note_frontend import (
    _checkpoint_path,
    _sha256,
    _validate_policy,
    _warm_up_note_model,
)


SAMPLE_RATE = 16000
TARGET_ANCHOR_SECONDS = 1.6
REAL_LOOKBACK_SECONDS = 1.0
FUTURE_SECONDS = 0.22
CADENCE_SECONDS = 0.150
INITIALIZATION_PRE_SECONDS = 0.120
RETRIGGER_MIN_DELTA_SECONDS = -0.120
RETRIGGER_MAX_DELTA_SECONDS = 0.050
EVENT_DEDUPE_SECONDS = 0.050
EVENT_RULES = {
    "temporally_bound": "frame_at_onset_peak",
    "model_native_event_stream": "official_regression_peak_event_stream",
}
MODEL_NATIVE_NEIGHBOUR = 2

TARGET_LOCAL_CASE_KINDS = {
    "correct_strike",
    "correct_chord",
    "wrong_semitone",
    "wrong_octave",
    "missing_chord_tone",
}
NO_RETRIGGER_CASE_KINDS = {
    "long_held_note_without_retrigger",
    "pedal_sustain_tail_without_retrigger",
}


def main() -> int:
    args = parse_args()
    policy_artifact = json.loads(args.policy.read_text(encoding="utf-8"))
    _validate_policy(policy_artifact)
    policy = policy_artifact["policy"]
    frontend = policy_artifact["frontend"]
    window = policy_artifact["benchmark_window"]
    checkpoint_path = _checkpoint_path(frontend)
    checkpoint_sha256 = _sha256(checkpoint_path)
    if checkpoint_sha256 != frontend["checkpoint_sha256"]:
        raise ValueError(
            "ByteDance checkpoint SHA256 mismatch: "
            f"expected {frontend['checkpoint_sha256']}, got {checkpoint_sha256}"
        )

    cases = [
        (manifest_path, case)
        for manifest_path in args.case_manifest
        for case in json.loads(manifest_path.read_text(encoding="utf-8")).get("cases", ())
    ]

    provider = ByteDancePianoTranscriptionProvider(
        checkpoint_path=checkpoint_path,
        device=args.device,
    )
    _warm_up_note_model(provider, device=args.device)

    evaluations = [
        _evaluate_case(
            manifest_path,
            case,
            provider=provider,
            device=args.device,
            local_pre_seconds=float(window["local_pre_seconds"]),
            local_post_seconds=float(window["local_post_seconds"]),
            onset_threshold=float(policy["target_onset_min"]),
            frame_threshold=float(policy["target_frame_min"]),
            cadence_seconds=args.cadence_seconds,
        )
        for manifest_path, case in cases
    ]

    report = {
        "benchmark_scope": "bytedance_rolling_onset_frame_step_replay_dev_cal",
        "scope_wording": (
            "Research-only rolling STEP event replay. It does not use an external "
            "strike detector or oracle target timestamp at runtime, but first-target "
            "state establishment is oracle-initialized because case pre-context is "
            "only acoustic context and does not contain full score-state history."
        ),
        "constraints": {
            "frozen_evaluation_used": False,
            "production_modified": False,
            "threshold_tuning": False,
            "rtt_used": False,
            "ov_benchmark_used": False,
            "external_strike_detector_used": False,
            "browser_optimization": False,
        },
        "runtime_inputs": [
            "16 kHz mono PCM",
            "current expected pitch group",
            "previous consumed-event boundary",
        ],
        "runtime_forbidden": [
            "MIDI",
            "GT strike timestamp",
            "case kind",
            "actual pitch",
            "future GT information",
        ],
        "offline_scoring_uses": [
            "MIDI-derived target timestamps",
            "case kind",
            "actual pitch groups",
        ],
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
            "rolling_contract": {
                "max_real_lookback_ms": int(REAL_LOOKBACK_SECONDS * 1000),
                "target_anchor_ms": int(TARGET_ANCHOR_SECONDS * 1000),
                "future_ms": int(FUTURE_SECONDS * 1000),
                "cadence_ms": int(args.cadence_seconds * 1000),
                "event_dedupe_ms": int(EVENT_DEDUPE_SECONDS * 1000),
                "local_evidence_ms": [
                    int(-float(window["local_pre_seconds"]) * 1000),
                    int(float(window["local_post_seconds"]) * 1000),
                ],
            },
        },
        "case_manifests": [str(path) for path in args.case_manifest],
        "case_count": len(cases),
        "summary_by_event_rule": {
            rule_name: _summary(evaluations, rule_name=rule_name)
            for rule_name in EVENT_RULES
        },
        "paired_comparison": _paired_comparison(evaluations),
        "failure_diagnostics_by_event_rule": {
            rule_name: _failure_diagnostics(evaluations, rule_name=rule_name)
            for rule_name in EVENT_RULES
        },
        "positive_control_diagnostics_by_event_rule": {
            rule_name: _positive_control_diagnostics(evaluations, rule_name=rule_name)
            for rule_name in EVENT_RULES
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
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--cadence-seconds", type=float, default=CADENCE_SECONDS)
    return parser.parse_args()


def _evaluate_case(
    manifest_path: Path,
    case: dict[str, object],
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    cadence_seconds: float,
) -> dict[str, object]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE} Hz case audio, got {sample_rate}: {audio_path}")

    source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    target_relative = tuple(max(0.0, value - source_start) for value in target_seconds)
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
    case_kind = str(case.get("case_kind"))

    anchors = _anchor_schedule(audio_duration_seconds=audio.size / sample_rate, cadence_seconds=cadence_seconds)
    inference_rows, latency_rows = _run_periodic_inference(
        audio,
        sample_rate=sample_rate,
        anchors=anchors,
        provider=provider,
        device=device,
        local_pre_seconds=local_pre_seconds,
        local_post_seconds=local_post_seconds,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
    )

    rolling_results = {}
    for rule_name, frame_rule in EVENT_RULES.items():
        if case_kind in TARGET_LOCAL_CASE_KINDS:
            result = _evaluate_target_local_case(
                case,
                expected_groups=expected_groups,
                actual_groups=actual_groups,
                target_relative=target_relative,
                inferences=inference_rows,
                frame_rule=frame_rule,
            )
        elif case_kind == "same_note_retrigger":
            result = _evaluate_same_note_retrigger(
                expected_groups=expected_groups,
                target_relative=target_relative,
                inferences=inference_rows,
                frame_rule=frame_rule,
            )
        elif case_kind in NO_RETRIGGER_CASE_KINDS:
            result = _evaluate_no_retrigger(
                expected_groups=expected_groups,
                target_relative=target_relative,
                inferences=inference_rows,
                frame_rule=frame_rule,
            )
        else:
            result = {
                "mode": "unsupported_case_kind",
                "accepted": False,
                "reason": f"unsupported case_kind {case_kind}",
            }
        rolling_results[rule_name] = result

    future_contamination = _case_future_contamination(
        case,
        expected_groups=expected_groups,
        actual_groups=actual_groups,
        target_seconds=target_seconds,
    )
    event_pressure = _event_pressure(inference_rows, audio_duration_seconds=audio.size / sample_rate)
    return {
        "case_id": case.get("case_id"),
        "case_kind": case_kind,
        "source_identity": _case_source_identity(case),
        "expected_groups": expected_groups,
        "actual_groups": actual_groups,
        "target_relative_seconds": tuple(round(value, 6) for value in target_relative),
        "oracle_initialized": case_kind in (NO_RETRIGGER_CASE_KINDS | {"same_note_retrigger"} | TARGET_LOCAL_CASE_KINDS),
        "rolling_results": rolling_results,
        "future_target_contaminated": any(item["contaminated"] for item in future_contamination),
        "future_target_contamination": future_contamination,
        "event_pressure": event_pressure,
        "latency_samples": latency_rows,
        "inference_call_count": len(inference_rows),
    }


def _run_periodic_inference(
    audio: np.ndarray,
    *,
    sample_rate: int,
    anchors: tuple[float, ...],
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    clip_audios = []
    clip_starts = []
    for anchor in anchors:
        clip_audio, clip_start = _fixed_anchor_clip(audio, sample_rate=sample_rate, anchor_seconds=anchor)
        clip_audios.append(clip_audio)
        clip_starts.append(clip_start)
    started = perf_counter()
    raw_outputs, forward_latency = _direct_note_forward_batch(
        provider,
        clip_audios,
        sample_rate,
        device=device,
    )
    end_to_end_ms = (perf_counter() - started) * 1000.0
    per_window_forward_ms = forward_latency["forward_ms"] / max(len(anchors), 1)
    per_window_end_to_end_ms = end_to_end_ms / max(len(anchors), 1)
    rows = []
    latencies = []
    for anchor, clip_start, raw_output in zip(anchors, clip_starts, raw_outputs, strict=True):
        rows.append(
            {
                "anchor_time": anchor,
                "decision_time": anchor + FUTURE_SECONDS,
                "clip_start_seconds": clip_start,
                "raw_output": raw_output,
                "local_pre_seconds": local_pre_seconds,
                "local_post_seconds": local_post_seconds,
                "onset_threshold": onset_threshold,
                "frame_threshold": frame_threshold,
            }
        )
        latencies.append(
            {
                "anchor_time": round(anchor, 6),
                "forward_ms": round(float(per_window_forward_ms), 3),
                "target_evidence_end_to_end_ms": round(per_window_end_to_end_ms, 3),
                "estimated_event_to_decision_ms": round(
                    FUTURE_SECONDS * 1000.0 + per_window_end_to_end_ms,
                    3,
                ),
            }
        )
    return rows, latencies


def _direct_note_forward_batch(
    provider: ByteDancePianoTranscriptionProvider,
    clip_audios: list[np.ndarray],
    sample_rate: int,
    *,
    device: str,
) -> tuple[list[dict[str, np.ndarray]], dict[str, float]]:
    import torch
    from piano_transcription_inference.inference import move_data_to_device

    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE} Hz audio, got {sample_rate}")
    if not clip_audios:
        return [], {"forward_ms": 0.0}
    lengths = {int(audio.size) for audio in clip_audios}
    if len(lengths) != 1:
        raise ValueError(f"batched rolling clips must have identical length, got {sorted(lengths)}")
    model = provider._transcriber.model
    note_model = model.module.note_model if hasattr(model, "module") else model.note_model
    batch = np.stack([audio.astype(np.float32, copy=False) for audio in clip_audios], axis=0)
    _sync(device)
    forward_started = perf_counter()
    tensor = move_data_to_device(batch, next(note_model.parameters()).device)
    with torch.no_grad():
        note_model.eval()
        output = note_model(tensor)
    _sync(device)
    forward_ms = (perf_counter() - forward_started) * 1000.0
    onsets = output["reg_onset_output"].detach().cpu().numpy()
    frames = output["frame_output"].detach().cpu().numpy()
    velocity = output["velocity_output"].detach().cpu().numpy()
    return [
        {
            "onset": onsets[index],
            "frame": frames[index],
            "velocity": velocity[index],
        }
        for index in range(onsets.shape[0])
    ], {"forward_ms": forward_ms}


def _evaluate_target_local_case(
    case: dict[str, object],
    *,
    expected_groups: tuple[tuple[str, ...], ...],
    actual_groups: tuple[tuple[str, ...], ...],
    target_relative: tuple[float, ...],
    inferences: list[dict[str, object]],
    frame_rule: str,
) -> dict[str, object]:
    if not expected_groups or not target_relative:
        return {"mode": "target_local", "accepted": False, "reason": "missing expected group or target"}
    target = target_relative[0]
    active_from = max(0.0, target - INITIALIZATION_PRE_SECONDS)
    active_until = target + RETRIGGER_MAX_DELTA_SECONDS
    step = _first_match(
        inferences,
        expected_groups[0],
        consumed_through_time=active_from,
        active_from=active_from,
        active_until=active_until,
        event_min_time=target + RETRIGGER_MIN_DELTA_SECONDS,
        event_max_time=target + RETRIGGER_MAX_DELTA_SECONDS,
        frame_rule=frame_rule,
    )
    accepted = step is not None
    expected_advances = int(case.get("expected_advances", 0))
    return {
        "mode": "oracle_target_local_diagnostic",
        "accepted": accepted,
        "expected_advances": expected_advances,
        "false_advance": bool(accepted and expected_advances == 0),
        "legitimate_advance": bool(accepted and expected_advances > 0),
        "target_relative_seconds": round(target, 6),
        "actual_pitches": actual_groups[0] if actual_groups else (),
        "match": step,
    }


def _evaluate_same_note_retrigger(
    *,
    expected_groups: tuple[tuple[str, ...], ...],
    target_relative: tuple[float, ...],
    inferences: list[dict[str, object]],
    frame_rule: str,
) -> dict[str, object]:
    if len(expected_groups) < 2 or len(target_relative) < 2:
        return {"mode": "same_note_retrigger", "first_advance_established": False, "reason": "missing targets"}
    first_target, second_target = target_relative[0], target_relative[1]
    first_active_from = max(0.0, first_target - INITIALIZATION_PRE_SECONDS)
    first = _first_match(
        inferences,
        expected_groups[0],
        consumed_through_time=first_active_from,
        active_from=first_active_from,
        active_until=first_target + RETRIGGER_MAX_DELTA_SECONDS,
        event_min_time=first_target + RETRIGGER_MIN_DELTA_SECONDS,
        event_max_time=first_target + RETRIGGER_MAX_DELTA_SECONDS,
        frame_rule=frame_rule,
    )
    if first is None:
        return {
            "mode": "same_note_retrigger",
            "first_advance_established": False,
            "second_legitimate_advance": False,
            "premature_second_advance": False,
            "missed_retrigger": True,
        }
    second = _first_match(
        inferences,
        expected_groups[1],
        consumed_through_time=float(first["consumed_through_time"]),
        active_from=float(first["decision_time"]),
        active_until=None,
        event_min_time=None,
        event_max_time=None,
        frame_rule=frame_rule,
    )
    if second is None:
        return {
            "mode": "same_note_retrigger",
            "first_advance_established": True,
            "first_match": first,
            "second_legitimate_advance": False,
            "premature_second_advance": False,
            "late_or_stale_second_match": False,
            "missed_retrigger": True,
        }
    event_time = float(second["latest_event_time"])
    delta = event_time - second_target
    if delta < RETRIGGER_MIN_DELTA_SECONDS:
        second_classification = "PREMATURE_FALSE_ADVANCE"
    elif delta <= RETRIGGER_MAX_DELTA_SECONDS:
        second_classification = "LEGITIMATE_RETRIGGER_ADVANCE"
    else:
        second_classification = "LATE_OR_STALE_MATCH"
    return {
        "mode": "same_note_retrigger",
        "first_advance_established": True,
        "first_match": first,
        "second_match": second,
        "second_event_delta_ms": round(delta * 1000.0, 3),
        "second_classification": second_classification,
        "second_legitimate_advance": second_classification == "LEGITIMATE_RETRIGGER_ADVANCE",
        "premature_second_advance": second_classification == "PREMATURE_FALSE_ADVANCE",
        "late_or_stale_second_match": second_classification == "LATE_OR_STALE_MATCH",
        "missed_retrigger": False,
    }


def _evaluate_no_retrigger(
    *,
    expected_groups: tuple[tuple[str, ...], ...],
    target_relative: tuple[float, ...],
    inferences: list[dict[str, object]],
    frame_rule: str,
) -> dict[str, object]:
    if len(expected_groups) < 2 or not target_relative:
        return {"mode": "no_retrigger", "first_advance_established": False, "reason": "missing groups"}
    first_target = target_relative[0]
    first_active_from = max(0.0, first_target - INITIALIZATION_PRE_SECONDS)
    first = _first_match(
        inferences,
        expected_groups[0],
        consumed_through_time=first_active_from,
        active_from=first_active_from,
        active_until=first_target + RETRIGGER_MAX_DELTA_SECONDS,
        event_min_time=first_target + RETRIGGER_MIN_DELTA_SECONDS,
        event_max_time=first_target + RETRIGGER_MAX_DELTA_SECONDS,
        frame_rule=frame_rule,
    )
    if first is None:
        return {
            "mode": "no_retrigger",
            "first_advance_established": False,
            "false_second_advance": False,
            "post_advance_verifier_calls": 0,
        }
    post_inferences = [
        row for row in inferences if float(row["decision_time"]) >= float(first["decision_time"])
    ]
    second = _first_match(
        post_inferences,
        expected_groups[1],
        consumed_through_time=float(first["consumed_through_time"]),
        active_from=float(first["decision_time"]),
        active_until=None,
        event_min_time=None,
        event_max_time=None,
        frame_rule=frame_rule,
    )
    return {
        "mode": "no_retrigger",
        "first_advance_established": True,
        "first_match": first,
        "post_advance_verifier_calls": len(post_inferences),
        "false_second_advance": second is not None,
        "false_second_match": second,
        "time_to_false_second_advance_ms": (
            round((float(second["decision_time"]) - float(first["decision_time"])) * 1000.0, 3)
            if second is not None
            else None
        ),
    }


def _first_match(
    inferences: list[dict[str, object]],
    expected_pitches: tuple[str, ...],
    *,
    consumed_through_time: float,
    active_from: float,
    active_until: float | None,
    event_min_time: float | None,
    event_max_time: float | None,
    frame_rule: str,
) -> dict[str, object] | None:
    for row in inferences:
        decision_time = float(row["decision_time"])
        if decision_time < active_from - 1e-9:
            continue
        if active_until is not None and float(row["anchor_time"]) > active_until + 1e-9:
            continue
        match = _match_from_inference(
            row,
            expected_pitches,
            consumed_through_time=consumed_through_time,
            event_min_time=event_min_time,
            event_max_time=event_max_time,
            frame_rule=frame_rule,
        )
        if match is not None:
            return match
    return None


def _match_from_inference(
    row: dict[str, object],
    expected_pitches: tuple[str, ...],
    *,
    consumed_through_time: float,
    event_min_time: float | None,
    event_max_time: float | None,
    frame_rule: str,
) -> dict[str, object] | None:
    events = []
    for pitch in expected_pitches:
        eligible_events = []
        for event in _pitch_events(row, pitch, frame_rule=frame_rule):
            event_time = float(event["event_time"])
            if event_time <= consumed_through_time + 1e-9:
                continue
            if event_min_time is not None and event_time < event_min_time - 1e-9:
                continue
            if event_max_time is not None and event_time > event_max_time + 1e-9:
                continue
            eligible_events.append(event)
        if not eligible_events:
            return None
        event = min(eligible_events, key=lambda item: float(item["event_time"]))
        events.append(event)
    observed = tuple(event["pitch"] for event in events)
    result, matched, missing, extra = _evaluate_expected(expected_pitches, observed)
    if result != "MATCH":
        return None
    latest_event_time = max(float(event["event_time"]) for event in events)
    earliest_event_time = min(float(event["event_time"]) for event in events)
    return {
        "anchor_time": round(float(row["anchor_time"]), 6),
        "decision_time": round(float(row["decision_time"]), 6),
        "expected_pitches": expected_pitches,
        "event_rule": frame_rule,
        "events": events,
        "earliest_event_time": round(earliest_event_time, 6),
        "latest_event_time": round(latest_event_time, 6),
        "latest_event_time_before_dedupe": round(latest_event_time, 6),
        "consumed_through_time": round(latest_event_time + EVENT_DEDUPE_SECONDS, 6),
        "event_dedupe_ms": int(EVENT_DEDUPE_SECONDS * 1000),
        "event_detection_delay_ms": round((latest_event_time - earliest_event_time) * 1000.0, 3),
        "decision_delay_from_latest_event_ms": round(
            (float(row["decision_time"]) - latest_event_time) * 1000.0,
            3,
        ),
        "matched_expected": matched,
        "missing_expected": missing,
        "extra_observed": extra,
    }


def _pitch_events(row: dict[str, object], pitch: str, *, frame_rule: str) -> list[dict[str, object]]:
    raw_output = row["raw_output"]
    onsets = raw_output["onset"]
    frames = raw_output["frame"]
    frame_times = _frame_times(raw_output, int(onsets.shape[0])) + float(row["clip_start_seconds"])
    frame_mask = (frame_times >= float(row["anchor_time"]) - float(row["local_pre_seconds"])) & (
        frame_times <= float(row["anchor_time"]) + float(row["local_post_seconds"])
    )
    if not np.any(frame_mask):
        return []
    pitch_index = _pitch_to_midi_note(pitch) - 21
    if pitch_index < 0 or pitch_index >= onsets.shape[1]:
        return []
    if frame_rule == "official_regression_peak_event_stream":
        return _model_native_pitch_events(
            row,
            pitch=pitch,
            pitch_index=pitch_index,
            frame_times=frame_times,
            frame_mask=frame_mask,
        )
    onset_values = onsets[frame_mask, pitch_index]
    frames_values = frames[frame_mask, pitch_index]
    masked_times = frame_times[frame_mask]
    onset_argmax = int(np.argmax(onset_values))
    frame_argmax = int(np.argmax(frames_values))
    onset_peak_score = float(onset_values[onset_argmax])
    onset_peak_time = float(masked_times[onset_argmax])
    frame_score_at_onset_peak = float(frames_values[onset_argmax])
    frame_peak_score = float(frames_values[frame_argmax])
    frame_peak_time = float(masked_times[frame_argmax])
    if frame_rule == "max_frame_in_local_window":
        frame_score_used = frame_peak_score
    elif frame_rule == "frame_at_onset_peak":
        frame_score_used = frame_score_at_onset_peak
    else:
        raise ValueError(f"unsupported frame rule: {frame_rule}")
    if onset_peak_score < float(row["onset_threshold"]) or frame_score_used < float(row["frame_threshold"]):
        return []
    return [
        {
            "pitch": pitch,
            "event_time": round(onset_peak_time, 6),
            "onset_peak_time": round(onset_peak_time, 6),
            "onset_peak_score": round(onset_peak_score, 6),
            "frame_score_at_onset_peak": round(frame_score_at_onset_peak, 6),
            "frame_peak_time": round(frame_peak_time, 6),
            "frame_peak_score": round(frame_peak_score, 6),
            "frame_peak_minus_onset_peak_ms": round((frame_peak_time - onset_peak_time) * 1000.0, 3),
            "frame_score_used": round(frame_score_used, 6),
            "event_rule": frame_rule,
            "relative_to_anchor_ms": round((onset_peak_time - float(row["anchor_time"])) * 1000.0, 3),
        }
    ]


def _model_native_pitch_events(
    row: dict[str, object],
    *,
    pitch: str,
    pitch_index: int,
    frame_times: np.ndarray,
    frame_mask: np.ndarray,
) -> list[dict[str, object]]:
    raw_output = row["raw_output"]
    onsets = raw_output["onset"]
    frames = raw_output["frame"]
    onset_threshold = float(row["onset_threshold"])
    frame_threshold = float(row["frame_threshold"])
    events = []
    x = onsets[:, pitch_index]
    for frame_index in range(MODEL_NATIVE_NEIGHBOUR, x.shape[0] - MODEL_NATIVE_NEIGHBOUR):
        if not frame_mask[frame_index]:
            continue
        if x[frame_index] <= onset_threshold:
            continue
        if not _is_monotonic_neighbour(x, frame_index, MODEL_NATIVE_NEIGHBOUR):
            continue
        shift = _regression_shift(x, frame_index)
        shifted_event_time = float(row["clip_start_seconds"]) + (frame_index + shift) / 100.0
        if shifted_event_time < float(row["anchor_time"]) - float(row["local_pre_seconds"]) - 1e-9:
            continue
        if shifted_event_time > float(row["anchor_time"]) + float(row["local_post_seconds"]) + 1e-9:
            continue
        frame_score_at_peak = float(frames[frame_index, pitch_index])
        if frame_score_at_peak < frame_threshold:
            continue
        left = max(0, frame_index - 2)
        right = min(x.shape[0], frame_index + 3)
        frame_time = float(frame_times[frame_index])
        events.append(
            {
                "pitch": pitch,
                "event_time": round(shifted_event_time, 6),
                "official_peak_frame_index": frame_index,
                "official_regression_shift_frames": round(float(shift), 6),
                "onset_peak_time": round(frame_time, 6),
                "shifted_event_time": round(shifted_event_time, 6),
                "onset_peak_score": round(float(x[frame_index]), 6),
                "frame_score_at_onset_peak": round(frame_score_at_peak, 6),
                "frame_peak_time": round(frame_time, 6),
                "frame_peak_score": round(frame_score_at_peak, 6),
                "frame_peak_minus_onset_peak_ms": 0.0,
                "frame_score_used": round(frame_score_at_peak, 6),
                "reg_onset_neighbourhood": [round(float(value), 6) for value in x[left:right]],
                "event_rule": "official_regression_peak_event_stream",
                "relative_to_anchor_ms": round(
                    (shifted_event_time - float(row["anchor_time"])) * 1000.0,
                    3,
                ),
            }
        )
    return sorted(events, key=lambda item: float(item["event_time"]))


def _is_monotonic_neighbour(x: np.ndarray, index: int, neighbour: int) -> bool:
    for offset in range(neighbour):
        if x[index - offset] < x[index - offset - 1]:
            return False
        if x[index + offset] < x[index + offset + 1]:
            return False
    return True


def _regression_shift(x: np.ndarray, index: int) -> float:
    current = float(x[index])
    left = float(x[index - 1])
    right = float(x[index + 1])
    if left > right:
        denom = current - right
    else:
        denom = current - left
    if abs(denom) < 1e-12:
        return 0.0
    return (right - left) / denom / 2.0


def _anchor_schedule(*, audio_duration_seconds: float, cadence_seconds: float) -> tuple[float, ...]:
    latest_anchor = max(0.0, audio_duration_seconds - FUTURE_SECONDS)
    count = int(np.floor(latest_anchor / cadence_seconds)) + 1
    anchors = [round(index * cadence_seconds, 6) for index in range(count)]
    if anchors and anchors[-1] < latest_anchor - 1e-6:
        anchors.append(round(latest_anchor, 6))
    if not anchors:
        anchors = [0.0]
    return tuple(anchors)


def _fixed_anchor_clip(
    audio: np.ndarray,
    *,
    sample_rate: int,
    anchor_seconds: float,
) -> tuple[np.ndarray, float]:
    available_real_lookback = min(REAL_LOOKBACK_SECONDS, max(0.0, anchor_seconds))
    real_start = anchor_seconds - available_real_lookback
    real_end = min(audio.size / sample_rate, anchor_seconds + FUTURE_SECONDS)
    real_audio = audio[int(round(real_start * sample_rate)) : int(round(real_end * sample_rate))]
    zero_pad_seconds = TARGET_ANCHOR_SECONDS - available_real_lookback
    zero_pad = np.zeros(int(round(max(0.0, zero_pad_seconds) * sample_rate)), dtype=real_audio.dtype)
    clip_audio = np.concatenate([zero_pad, real_audio])
    clip_start = anchor_seconds - TARGET_ANCHOR_SECONDS
    return clip_audio, clip_start


def _frame_times(raw_output: dict[str, np.ndarray], frame_count: int) -> np.ndarray:
    # ByteDance note_model emits 100 Hz activation frames.
    return np.arange(frame_count, dtype=np.float32) / 100.0


def _pitch_to_midi_note(pitch: str) -> int:
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    if len(pitch) < 2:
        raise ValueError(f"invalid pitch {pitch}")
    name = pitch[0]
    accidental = 0
    octave_index = 1
    if len(pitch) >= 3 and pitch[1] in {"#", "b"}:
        accidental = 1 if pitch[1] == "#" else -1
        octave_index = 2
    octave = int(pitch[octave_index:])
    return (octave + 1) * 12 + names[name] + accidental


def _case_future_contamination(
    case: dict[str, object],
    *,
    expected_groups: tuple[tuple[str, ...], ...],
    actual_groups: tuple[tuple[str, ...], ...],
    target_seconds: tuple[float, ...],
) -> list[dict[str, object]]:
    rows = []
    for index, expected in enumerate(expected_groups):
        if index >= len(target_seconds):
            continue
        actual = actual_groups[index] if index < len(actual_groups) else ()
        rows.append(
            _future_target_contamination(
                case,
                expected_pitches=expected,
                actual_pitches=actual,
                target_second=target_seconds[index],
                decision_end_seconds=target_seconds[index] + 0.35,
            )
        )
    return rows


def _event_pressure(
    inferences: list[dict[str, object]],
    *,
    audio_duration_seconds: float,
) -> dict[str, object]:
    minutes = max(audio_duration_seconds / 60.0, 1e-9)
    events = []
    for row in inferences:
        raw = row["raw_output"]
        onsets = raw["onset"]
        frame_times = _frame_times(raw, int(onsets.shape[0])) + float(row["clip_start_seconds"])
        frame_mask = (frame_times >= float(row["anchor_time"]) - float(row["local_pre_seconds"])) & (
            frame_times <= float(row["anchor_time"]) + float(row["local_post_seconds"])
        )
        if not np.any(frame_mask):
            continue
        local_onsets = onsets[frame_mask]
        accepted_positions = np.argwhere(local_onsets >= float(row["onset_threshold"]))
        local_times = frame_times[frame_mask]
        for time_index, pitch_index in accepted_positions:
            events.append((round(float(local_times[int(time_index)]), 3), int(pitch_index)))
    deduped = set(events)
    return {
        "inference_calls": len(inferences),
        "inference_calls_per_minute": round(len(inferences) / minutes, 6),
        "raw_onset_events": len(events),
        "deduplicated_onset_events": len(deduped),
        "deduplicated_onset_events_per_minute": round(len(deduped) / minutes, 6),
        "duplicate_detections_per_event": round(len(events) / len(deduped), 6) if deduped else None,
    }


def _summary(evaluations: list[dict[str, object]], *, rule_name: str) -> dict[str, object]:
    by_kind: dict[str, list[dict[str, object]]] = defaultdict(list)
    for evaluation in evaluations:
        by_kind[str(evaluation["case_kind"])].append(evaluation)
    return {
        "event_rule": {
            "name": rule_name,
            "frame_semantics": EVENT_RULES[rule_name],
        },
        "metrics": {
            "correct_single": _target_local_rate(by_kind["correct_strike"], "legitimate_advance", rule_name=rule_name),
            "correct_chord": _target_local_rate(by_kind["correct_chord"], "legitimate_advance", rule_name=rule_name),
            "wrong_semitone_target_local_false_match": _clean_false_rate(by_kind["wrong_semitone"], rule_name=rule_name),
            "wrong_octave_target_local_false_match": _clean_false_rate(by_kind["wrong_octave"], rule_name=rule_name),
            "missing_chord_target_local_false_match": _clean_false_rate(by_kind["missing_chord_tone"], rule_name=rule_name),
            "same_note_retrigger": _retrigger_summary(by_kind["same_note_retrigger"], rule_name=rule_name),
            "long_held_false_second_advance": _no_retrigger_summary(
                by_kind["long_held_note_without_retrigger"],
                rule_name=rule_name,
            ),
            "pedal_tail_false_second_advance": _no_retrigger_summary(
                by_kind["pedal_sustain_tail_without_retrigger"],
                rule_name=rule_name,
            ),
        },
        "pressure": _pressure_summary(evaluations),
        "latency": _latency_summary(evaluations),
        "decision": _decision(evaluations, rule_name=rule_name),
    }


def _rolling_result(item: dict[str, object], rule_name: str) -> dict[str, object]:
    return item["rolling_results"][rule_name]


def _target_local_rate(items: list[dict[str, object]], key: str, *, rule_name: str) -> dict[str, object]:
    values = [bool(_rolling_result(item, rule_name).get(key)) for item in items]
    return _bool_rate(values)


def _clean_false_rate(items: list[dict[str, object]], *, rule_name: str) -> dict[str, object]:
    clean = [item for item in items if not bool(item["future_target_contaminated"])]
    values = [bool(_rolling_result(item, rule_name).get("false_advance")) for item in clean]
    return _bool_rate(values)


def _retrigger_summary(items: list[dict[str, object]], *, rule_name: str) -> dict[str, object]:
    established = [item for item in items if _rolling_result(item, rule_name).get("first_advance_established")]
    return {
        "first_advance_established": _bool_rate(
            [_rolling_result(item, rule_name).get("first_advance_established") for item in items]
        ),
        "legitimate_second_advance": _bool_rate(
            [_rolling_result(item, rule_name).get("second_legitimate_advance") for item in established]
        ),
        "premature_second_advance": _bool_rate(
            [_rolling_result(item, rule_name).get("premature_second_advance") for item in established]
        ),
        "late_or_stale_second_match": _bool_rate(
            [_rolling_result(item, rule_name).get("late_or_stale_second_match") for item in established]
        ),
        "missed_retrigger": _bool_rate(
            [_rolling_result(item, rule_name).get("missed_retrigger") for item in established]
        ),
    }


def _no_retrigger_summary(items: list[dict[str, object]], *, rule_name: str) -> dict[str, object]:
    established = [item for item in items if _rolling_result(item, rule_name).get("first_advance_established")]
    return {
        "first_advance_established": _bool_rate(
            [_rolling_result(item, rule_name).get("first_advance_established") for item in items]
        ),
        "false_second_advance": _bool_rate(
            [_rolling_result(item, rule_name).get("false_second_advance") for item in established]
        ),
        "eligible_cases": len(established),
    }


def _pressure_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return {
        "inference_calls_per_minute": _distribution(
            [float(item["event_pressure"]["inference_calls_per_minute"]) for item in evaluations]
        ),
        "deduplicated_onset_events_per_minute": _distribution(
            [
                float(item["event_pressure"]["deduplicated_onset_events_per_minute"])
                for item in evaluations
            ]
        ),
        "duplicate_detections_per_event": _distribution(
            [
                float(item["event_pressure"]["duplicate_detections_per_event"])
                for item in evaluations
                if item["event_pressure"]["duplicate_detections_per_event"] is not None
            ]
        ),
    }


def _latency_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    forward = []
    end_to_end = []
    estimated = []
    for item in evaluations:
        for sample in item["latency_samples"]:
            forward.append(float(sample["forward_ms"]))
            end_to_end.append(float(sample["target_evidence_end_to_end_ms"]))
            estimated.append(float(sample["estimated_event_to_decision_ms"]))
    return {
        "note_model_forward_ms": _distribution(forward),
        "target_evidence_end_to_end_ms": _distribution(end_to_end),
        "estimated_event_to_decision_ms": _distribution(estimated),
        "sample_count": len(forward),
    }


def _decision(evaluations: list[dict[str, object]], *, rule_name: str) -> str:
    summary = {
        "wrong": sum(
            int(bool(_rolling_result(item, rule_name).get("false_advance")))
            for item in evaluations
            if item["case_kind"] in {"wrong_semitone", "wrong_octave", "missing_chord_tone"}
            and not bool(item["future_target_contaminated"])
        ),
        "held": sum(
            int(bool(_rolling_result(item, rule_name).get("false_second_advance")))
            for item in evaluations
            if item["case_kind"] in NO_RETRIGGER_CASE_KINDS
            and bool(_rolling_result(item, rule_name).get("first_advance_established"))
        ),
        "retrigger_legit": sum(
            int(bool(_rolling_result(item, rule_name).get("second_legitimate_advance")))
            for item in evaluations
            if item["case_kind"] == "same_note_retrigger"
            and bool(_rolling_result(item, rule_name).get("first_advance_established"))
        ),
    }
    if summary["wrong"] == 0 and summary["held"] == 0 and summary["retrigger_legit"] > 0:
        return "ByteDance rolling STEP = KEEP_CANDIDATE"
    return "ByteDance rolling STEP = STOP_OR_NEEDS_FURTHER_ANALYSIS"


def _failure_diagnostics(evaluations: list[dict[str, object]], *, rule_name: str) -> dict[str, object]:
    rows = []
    for item in evaluations:
        kind = str(item["case_kind"])
        result = _rolling_result(item, rule_name)
        include = False
        failure_kind = None
        match = None
        if kind in {"wrong_semitone", "wrong_octave", "missing_chord_tone"}:
            include = bool(result.get("false_advance")) and not bool(item["future_target_contaminated"])
            failure_kind = "target_local_wrong_note_false_match"
            match = result.get("match")
        elif kind in NO_RETRIGGER_CASE_KINDS:
            include = bool(result.get("false_second_advance"))
            failure_kind = "no_retrigger_false_second_match"
            match = result.get("false_second_match")
        elif kind == "same_note_retrigger":
            include = bool(result.get("missed_retrigger"))
            failure_kind = "same_note_missed_retrigger"
            match = result.get("second_match")
        if not include:
            continue
        rows.append(
            {
                "source_recording_id": item["source_identity"]["source_recording_id"],
                "case_id": item["case_id"],
                "case_kind": kind,
                "failure_kind": failure_kind,
                "target_relative_seconds": item["target_relative_seconds"],
                "match": _event_timing_summary(match),
                "rolling_result_summary": {
                    key: result.get(key)
                    for key in (
                        "false_advance",
                        "false_second_advance",
                        "second_legitimate_advance",
                        "premature_second_advance",
                        "missed_retrigger",
                        "second_classification",
                    )
                    if key in result
                },
            }
        )
    return {
        "count": len(rows),
        "rows": rows,
    }


def _positive_control_diagnostics(
    evaluations: list[dict[str, object]], *, rule_name: str
) -> dict[str, object]:
    rows = []
    for item in evaluations:
        if item["case_kind"] != "same_note_retrigger":
            continue
        result = _rolling_result(item, rule_name)
        if not result.get("second_legitimate_advance"):
            continue
        rows.append(
            {
                "source_recording_id": item["source_identity"]["source_recording_id"],
                "case_id": item["case_id"],
                "case_kind": item["case_kind"],
                "target_relative_seconds": item["target_relative_seconds"],
                "second_event_delta_ms": result.get("second_event_delta_ms"),
                "match": _event_timing_summary(result.get("second_match")),
            }
        )
    return {
        "count": len(rows),
        "rows": rows,
    }


def _paired_comparison(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return {
        kind: _paired_no_retrigger_kind(evaluations, case_kind=kind)
        for kind in sorted(NO_RETRIGGER_CASE_KINDS)
    }


def _paired_no_retrigger_kind(
    evaluations: list[dict[str, object]], *, case_kind: str
) -> dict[str, object]:
    rows = []
    for item in evaluations:
        if item["case_kind"] != case_kind:
            continue
        a = _rolling_result(item, "temporally_bound")
        b = _rolling_result(item, "model_native_event_stream")
        if not (a.get("first_advance_established") and b.get("first_advance_established")):
            continue
        a_false = bool(a.get("false_second_advance"))
        b_false = bool(b.get("false_second_advance"))
        if a_false and b_false:
            bucket = "false_under_both"
        elif a_false and not b_false:
            bucket = "A_false_to_B_safe"
        elif not a_false and b_false:
            bucket = "A_safe_to_B_false"
        else:
            bucket = "safe_under_both"
        rows.append(
            {
                "case_id": item["case_id"],
                "source_recording_id": item["source_identity"]["source_recording_id"],
                "bucket": bucket,
                "A_false": a_false,
                "B_false": b_false,
                "A_match": _event_timing_summary(a.get("false_second_match")),
                "B_match": _event_timing_summary(b.get("false_second_match")),
            }
        )
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        counts[str(row["bucket"])] += 1
    return {
        "eligible_intersection": len(rows),
        "counts": dict(sorted(counts.items())),
        "rows": rows,
    }


def _event_timing_summary(match: object) -> object:
    if not isinstance(match, dict):
        return match
    return {
        "anchor_time": match.get("anchor_time"),
        "decision_time": match.get("decision_time"),
        "earliest_event_time": match.get("earliest_event_time"),
        "latest_event_time": match.get("latest_event_time"),
        "events": [
            {
                "pitch": event.get("pitch"),
                "event_time": event.get("event_time"),
                "onset_peak_score": event.get("onset_peak_score"),
                "frame_score_at_onset_peak": event.get("frame_score_at_onset_peak"),
                "frame_peak_score": event.get("frame_peak_score"),
                "frame_peak_minus_onset_peak_ms": event.get("frame_peak_minus_onset_peak_ms"),
                "frame_score_used": event.get("frame_score_used"),
                "official_peak_frame_index": event.get("official_peak_frame_index"),
                "shifted_event_time": event.get("shifted_event_time"),
                "official_regression_shift_frames": event.get("official_regression_shift_frames"),
                "reg_onset_neighbourhood": event.get("reg_onset_neighbourhood"),
                "event_rule": event.get("event_rule"),
                "relative_to_anchor_ms": event.get("relative_to_anchor_ms"),
            }
            for event in match.get("events", ())
        ],
    }


def _bool_rate(values: list[object]) -> dict[str, object]:
    total = len(values)
    accepted = sum(1 for value in values if bool(value))
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


def _sync(device: str) -> None:
    if device == "cuda":
        import torch

        if torch.cuda.is_available():
            torch.cuda.synchronize()


if __name__ == "__main__":
    raise SystemExit(main())
