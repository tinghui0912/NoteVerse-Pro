"""Research-only oracle-timestamp rolling-buffer equivalence for STEP audio.

This script verifies that a rolling PCM buffer can reproduce the fixed-anchor
bounded-window tensor exactly before running any model inference.

Metadata:
- oracle_target_timestamp = true
- causal_attempt_detection = false
- streaming_causal_model = false
- product_false_advance_eligible = false
"""

from __future__ import annotations

import argparse
from collections import defaultdict, deque
import hashlib
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
)
from evaluate_bytedance_direct_note_frontend import (
    _checkpoint_path,
    _direct_note_forward,
    _sha256,
    _validate_policy,
    _warm_up_note_model,
)


SAMPLE_RATE = 16_000
TARGET_ANCHOR_MS = 1600
REAL_LOOKBACK_MS = 1000
FUTURE_PREFIX_MS = 220
TARGET_ANCHOR_SAMPLES = round(SAMPLE_RATE * TARGET_ANCHOR_MS / 1000)
REAL_LOOKBACK_SAMPLES = round(SAMPLE_RATE * REAL_LOOKBACK_MS / 1000)
FUTURE_PREFIX_SAMPLES = round(SAMPLE_RATE * FUTURE_PREFIX_MS / 1000)
TENSOR_SAMPLES = TARGET_ANCHOR_SAMPLES + FUTURE_PREFIX_SAMPLES


class RollingPcmBuffer:
    """A small real-PCM-only rolling buffer with absolute sample indices."""

    def __init__(self, *, max_retained_samples: int) -> None:
        self.max_retained_samples = max_retained_samples
        self._chunks: deque[np.ndarray] = deque()
        self.start_sample_index = 0
        self.received_samples = 0
        self._stored_samples = 0

    def append(self, chunk: np.ndarray) -> None:
        if chunk.size == 0:
            return
        stored = np.asarray(chunk, dtype=np.float32).copy()
        self._chunks.append(stored)
        self.received_samples += int(stored.size)
        self._stored_samples += int(stored.size)
        self._trim()

    def extract(self, *, start_sample: int, end_sample: int) -> np.ndarray:
        if start_sample < self.start_sample_index:
            raise ValueError(
                f"requested start {start_sample} before retained start {self.start_sample_index}"
            )
        if end_sample > self.received_samples:
            raise ValueError(
                f"requested end {end_sample} after received {self.received_samples}"
            )
        if start_sample >= end_sample:
            return np.array([], dtype=np.float32)
        offset = start_sample - self.start_sample_index
        remaining = end_sample - start_sample
        parts: list[np.ndarray] = []
        for chunk in self._chunks:
            if offset >= chunk.size:
                offset -= int(chunk.size)
                continue
            take = min(int(chunk.size - offset), remaining)
            parts.append(chunk[offset : offset + take])
            remaining -= take
            offset = 0
            if remaining == 0:
                break
        if remaining != 0:
            raise RuntimeError("ring buffer extraction failed to collect requested samples")
        return np.concatenate(parts).astype(np.float32, copy=False) if parts else np.array([], dtype=np.float32)

    def _trim(self) -> None:
        while self._stored_samples > self.max_retained_samples and self._chunks:
            excess = self._stored_samples - self.max_retained_samples
            first = self._chunks[0]
            if excess >= first.size:
                removed = self._chunks.popleft()
                self.start_sample_index += int(removed.size)
                self._stored_samples -= int(removed.size)
            else:
                self._chunks[0] = first[int(excess) :]
                self.start_sample_index += int(excess)
                self._stored_samples -= int(excess)
                break


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

    offline_reference_report = json.loads(args.fixed_anchor_report.read_text(encoding="utf-8"))
    fixed_reference = offline_reference_report["devices"][args.reference_device][
        "fixed_anchor_evaluations"
    ]
    cases = [
        (manifest_path, case)
        for manifest_path in args.case_manifest
        for case in json.loads(manifest_path.read_text(encoding="utf-8")).get("cases", ())
    ]

    gate_report = _sample_gate_for_cases(
        cases,
        chunk_samples=args.chunk_samples,
        max_retained_samples=args.max_retained_samples,
    )
    if not gate_report["all_groups_equivalent"]:
        report = _base_report(
            args=args,
            policy=policy,
            window=window,
            checkpoint_sha256=checkpoint_sha256,
            case_count=len(cases),
            gate_report=gate_report,
        )
        _write_report(report, args.output)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    device_reports = {}
    for device in args.device:
        provider = ByteDancePianoTranscriptionProvider(
            checkpoint_path=checkpoint_path,
            device=device,
        )
        _warm_up_note_model(provider, device=device)
        evaluations = [
            _evaluate_case_from_gate(
                gate_case,
                provider=provider,
                device=device,
                local_pre_seconds=float(window["local_pre_seconds"]),
                local_post_seconds=float(window["local_post_seconds"]),
                decision_horizon_seconds=float(window["decision_horizon_seconds"]),
                onset_threshold=float(policy["target_onset_min"]),
                frame_threshold=float(policy["target_frame_min"]),
            )
            for gate_case in gate_report["case_extractions"]
        ]
        device_reports[device] = {
            "metrics": _metrics_for(evaluations),
            "per_source_metrics": _per_source_metrics(evaluations),
            "no_local_model_frames": _no_local_frame_count(evaluations),
            "agreement_vs_fixed_anchor": _agreement_summary(evaluations, fixed_reference),
            "disagreements_vs_fixed_anchor": _disagreements(evaluations, fixed_reference),
            "latency": _latency_summary(evaluations, gate_report),
            "evaluations": evaluations,
        }

    report = _base_report(
        args=args,
        policy=policy,
        window=window,
        checkpoint_sha256=checkpoint_sha256,
        case_count=len(cases),
        gate_report=gate_report,
    )
    report["devices"] = device_reports
    _write_report(report, args.output)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--fixed-anchor-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--chunk-samples", type=int, default=640)
    parser.add_argument("--max-retained-samples", type=int, default=40_000)
    parser.add_argument("--device", action="append", default=None)
    parser.add_argument("--reference-device", default="cuda")
    args = parser.parse_args()
    if args.device is None:
        args.device = ["cuda"]
    return args


def _sample_gate_for_cases(
    cases: list[tuple[Path, dict[str, object]]],
    *,
    chunk_samples: int,
    max_retained_samples: int,
) -> dict[str, object]:
    group_reports = []
    missing_target_groups = []
    case_extractions = []
    chunk_sizes: list[int] = []
    overshoots: list[int] = []
    extraction_latencies_ms: list[float] = []
    expected_group_count = 0
    for manifest_path, case in cases:
        audio_path = _case_audio_path(case, manifest_path=manifest_path)
        audio, sample_rate = _read_wav(audio_path)
        if sample_rate != SAMPLE_RATE:
            raise ValueError(f"expected {SAMPLE_RATE}Hz WAV, got {sample_rate}: {audio_path}")
        source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
        target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
        expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
        if len(target_seconds) < len(expected_groups):
            target_seconds = tuple(source_start + 1.0 for _ in expected_groups)
        pending = [
            {
                "group_index": index,
                "target_second": target_second,
                "target_sample": _sample_index(target_second - source_start),
                "decision_sample": _sample_index(target_second - source_start) + FUTURE_PREFIX_SAMPLES,
            }
            for index, target_second in enumerate(target_seconds[: len(expected_groups)])
        ]
        expected_group_count += len(pending)
        pending.sort(key=lambda item: int(item["decision_sample"]))
        pending_index = 0
        buffer = RollingPcmBuffer(max_retained_samples=max_retained_samples)
        group_extractions = []
        for chunk_start in range(0, int(audio.size), chunk_samples):
            chunk = audio[chunk_start : chunk_start + chunk_samples]
            chunk_sizes.append(int(chunk.size))
            buffer.append(chunk)
            while pending_index < len(pending) and buffer.received_samples >= int(
                pending[pending_index]["decision_sample"]
            ):
                item = pending[pending_index]
                target_sample = int(item["target_sample"])
                decision_sample = int(item["decision_sample"])
                started = perf_counter()
                rolling_tensor = _extract_fixed_anchor_tensor_from_buffer(
                    buffer,
                    target_sample=target_sample,
                    decision_sample=decision_sample,
                )
                extraction_ms = (perf_counter() - started) * 1000.0
                offline_tensor = _fixed_anchor_tensor_from_audio(audio, target_sample=target_sample)
                same_shape = rolling_tensor.shape == offline_tensor.shape
                same_samples = int(rolling_tensor.size) == int(offline_tensor.size)
                max_abs = (
                    float(np.max(np.abs(rolling_tensor - offline_tensor)))
                    if same_shape and rolling_tensor.size
                    else None
                )
                rolling_hash = _array_hash(rolling_tensor)
                offline_hash = _array_hash(offline_tensor)
                equivalent = (
                    same_shape
                    and same_samples
                    and target_sample - (target_sample - TARGET_ANCHOR_SAMPLES)
                    == TARGET_ANCHOR_SAMPLES
                    and max_abs == 0.0
                    and rolling_hash == offline_hash
                )
                overshoot = buffer.received_samples - decision_sample
                overshoots.append(int(overshoot))
                extraction_latencies_ms.append(extraction_ms)
                group_report = {
                    "source_recording_id": _case_source_identity(case)["source_recording_id"],
                    "case_id": case.get("case_id"),
                    "case_kind": case.get("case_kind"),
                    "group_index": int(item["group_index"]),
                    "target_second": round(float(item["target_second"]), 6),
                    "target_sample_index": target_sample,
                    "target_anchor_sample_index": TARGET_ANCHOR_SAMPLES,
                    "shape_equal": same_shape,
                    "sample_count_equal": same_samples,
                    "tensor_sample_count": int(rolling_tensor.size),
                    "max_abs_sample_diff": max_abs,
                    "hash_equal": rolling_hash == offline_hash,
                    "rolling_hash": rolling_hash,
                    "offline_hash": offline_hash,
                    "equivalent": equivalent,
                    "chunk_overshoot_samples": int(overshoot),
                    "chunk_overshoot_ms": round(overshoot / SAMPLE_RATE * 1000.0, 6),
                    "extraction_copy_latency_ms": round(extraction_ms, 6),
                }
                group_reports.append(group_report)
                group_extractions.append(
                    {
                        "group_index": int(item["group_index"]),
                        "target_second": float(item["target_second"]),
                        "target_sample_index": target_sample,
                        "tensor": rolling_tensor,
                        "gate": group_report,
                    }
                )
                pending_index += 1
        if pending_index != len(pending):
            for item in pending[pending_index:]:
                missing_target_groups.append(
                    {
                        "source_recording_id": _case_source_identity(case)["source_recording_id"],
                        "case_id": case.get("case_id"),
                        "case_kind": case.get("case_kind"),
                        "group_index": int(item["group_index"]),
                        "target_second": round(float(item["target_second"]), 6),
                        "target_sample_index": int(item["target_sample"]),
                        "decision_sample_index": int(item["decision_sample"]),
                        "received_samples_at_case_end": int(buffer.received_samples),
                    }
                )
        case_extractions.append(
            {
                "manifest_path": str(manifest_path),
                "case": case,
                "source_identity": _case_source_identity(case),
                "group_extractions": group_extractions,
            }
        )
    equivalent_count = sum(1 for group in group_reports if group["equivalent"])
    return {
        "chunking_contract": {
            "chunk_samples": chunk_samples,
            "sample_rate": SAMPLE_RATE,
            "chunk_duration_ms": round(chunk_samples / SAMPLE_RATE * 1000.0, 6),
            "parameterized": True,
            "final_browser_scheduling_equivalence_claimed": False,
        },
        "metadata": {
            "oracle_target_timestamp": True,
            "causal_attempt_detection": False,
            "streaming_causal_model": False,
            "product_false_advance_eligible": False,
        },
        "group_count": expected_group_count,
        "extracted_group_count": len(group_reports),
        "tensor_equivalent_groups": equivalent_count,
        "all_groups_equivalent": equivalent_count == expected_group_count
        and not missing_target_groups,
        "failed_groups": [group for group in group_reports if not group["equivalent"]],
        "missing_target_groups": missing_target_groups,
        "group_reports": group_reports,
        "chunk_size_distribution_samples": _distribution(chunk_sizes),
        "chunk_overshoot_samples": _distribution(overshoots),
        "chunk_overshoot_ms": _distribution([value / SAMPLE_RATE * 1000.0 for value in overshoots]),
        "extraction_copy_latency_ms": _distribution(extraction_latencies_ms),
        "case_extractions": case_extractions,
    }


def _evaluate_case_from_gate(
    gate_case: dict[str, object],
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    local_pre_seconds: float,
    local_post_seconds: float,
    decision_horizon_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[str, object]:
    case = gate_case["case"]
    source_identity = gate_case["source_identity"]
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
    group_by_index = {
        int(group["group_index"]): group
        for group in gate_case["group_extractions"]
    }
    group_results = []
    latency_samples = []
    for index, expected_pitches in enumerate(expected_groups):
        extraction = group_by_index[index]
        clip_audio = extraction["tensor"]
        target_second = float(extraction["target_second"])
        end_to_end_started = perf_counter()
        raw_output, forward_latency = _direct_note_forward(
            provider,
            clip_audio,
            SAMPLE_RATE,
            device=device,
        )
        prediction = _activation_prediction(
            raw_output,
            expected_pitches=expected_pitches,
            clip_start_seconds=target_second - TARGET_ANCHOR_MS / 1000.0,
            analysis_start_seconds=target_second - local_pre_seconds,
            analysis_end_seconds=target_second + local_post_seconds,
            target_second=target_second,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
        )
        _sync(device)
        compute_ms = (perf_counter() - end_to_end_started) * 1000.0
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
        gate = extraction["gate"]
        latency_samples.append(
            {
                "forward_ms": round(forward_latency["forward_ms"], 6),
                "target_evidence_compute_ms": round(compute_ms, 6),
                "extraction_copy_latency_ms": gate["extraction_copy_latency_ms"],
                "chunk_overshoot_ms": gate["chunk_overshoot_ms"],
                "research_strike_to_decision_ms": round(
                    FUTURE_PREFIX_MS
                    + float(gate["chunk_overshoot_ms"])
                    + float(gate["extraction_copy_latency_ms"])
                    + compute_ms,
                    6,
                ),
            }
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
                "gate": gate,
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
        "source_identity": source_identity,
        "group_results": group_results,
        "latency_samples": latency_samples,
    }


def _extract_fixed_anchor_tensor_from_buffer(
    buffer: RollingPcmBuffer,
    *,
    target_sample: int,
    decision_sample: int,
) -> np.ndarray:
    available_real = min(REAL_LOOKBACK_SAMPLES, target_sample)
    real_start = target_sample - available_real
    real_audio = buffer.extract(start_sample=real_start, end_sample=decision_sample)
    zero_pad = np.zeros(TARGET_ANCHOR_SAMPLES - available_real, dtype=np.float32)
    return np.concatenate([zero_pad, real_audio]).astype(np.float32, copy=False)


def _fixed_anchor_tensor_from_audio(audio: np.ndarray, *, target_sample: int) -> np.ndarray:
    available_real = min(REAL_LOOKBACK_SAMPLES, target_sample)
    real_start = target_sample - available_real
    decision_sample = min(int(audio.size), target_sample + FUTURE_PREFIX_SAMPLES)
    real_audio = audio[real_start:decision_sample].astype(np.float32, copy=False)
    zero_pad = np.zeros(TARGET_ANCHOR_SAMPLES - available_real, dtype=np.float32)
    return np.concatenate([zero_pad, real_audio]).astype(np.float32, copy=False)


def _base_report(
    *,
    args: argparse.Namespace,
    policy: dict[str, object],
    window: dict[str, object],
    checkpoint_sha256: str,
    case_count: int,
    gate_report: dict[str, object],
) -> dict[str, object]:
    return {
        "benchmark_scope": "bytedance_oracle_timestamp_rolling_buffer_equivalence",
        "terminology": "bounded-window runtime research candidate",
        "not_truly_causal_streaming_reason": (
            "The frontend still uses centered STFT features and a bidirectional GRU."
        ),
        "frozen_evaluation_used": False,
        "production_modified": False,
        "threshold_tuned": False,
        "strike_detector_implemented": False,
        "fixed_anchor_report": str(args.fixed_anchor_report),
        "case_manifests": [str(path) for path in args.case_manifest],
        "case_count": case_count,
        "checkpoint_sha256": checkpoint_sha256,
        "policy": policy,
        "benchmark_window": window,
        "recognition_contract": {
            "sample_rate": SAMPLE_RATE,
            "channels": 1,
            "max_real_lookback_ms": REAL_LOOKBACK_MS,
            "target_anchor_ms": TARGET_ANCHOR_MS,
            "future_ms": FUTURE_PREFIX_MS,
            "zero_padding_generated_at_extraction": True,
            "ring_buffer_stores_real_pcm_only": True,
        },
        "gate": {
            key: value
            for key, value in gate_report.items()
            if key != "case_extractions"
        },
    }


def _write_report(report: dict[str, object], output: Path | None) -> None:
    if output is None:
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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
        rows.append(
            {
                "source_recording_id": evaluation["source_identity"]["source_recording_id"],
                "case_id": evaluation["case_id"],
                "case_kind": evaluation["case_kind"],
                "rolling_decision": bool(evaluation["accepted"]),
                "fixed_anchor_decision": bool(reference_evaluation["accepted"]),
            }
        )
    return rows


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


def _latency_summary(
    evaluations: list[dict[str, object]],
    gate_report: dict[str, object],
) -> dict[str, object]:
    forward = []
    compute = []
    extraction = []
    overshoot = []
    total = []
    for evaluation in evaluations:
        for sample in evaluation["latency_samples"]:
            forward.append(float(sample["forward_ms"]))
            compute.append(float(sample["target_evidence_compute_ms"]))
            extraction.append(float(sample["extraction_copy_latency_ms"]))
            overshoot.append(float(sample["chunk_overshoot_ms"]))
            total.append(float(sample["research_strike_to_decision_ms"]))
    return {
        "chunk_overshoot_samples": gate_report["chunk_overshoot_samples"],
        "chunk_overshoot_ms": gate_report["chunk_overshoot_ms"],
        "ring_buffer_extraction_copy_ms": _distribution(extraction),
        "note_model_forward_ms": _distribution(forward),
        "model_evidence_compute_ms": _distribution(compute),
        "research_strike_to_decision_ms": _distribution(total),
    }


def _rate(evaluations: object) -> dict[str, object]:
    items = tuple(evaluations)
    accepted = sum(1 for evaluation in items if bool(evaluation["accepted"]))
    total = len(items)
    return {"accepted": accepted, "total": total, "rate": round(accepted / total, 6) if total else None}


def _distribution(values: list[float] | list[int]) -> dict[str, object]:
    if not values:
        return {"min": None, "median": None, "p95": None, "max": None, "mean": None}
    ordered = sorted(float(value) for value in values)
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


def _sample_index(seconds: float) -> int:
    return int(round(seconds * SAMPLE_RATE))


def _array_hash(array: np.ndarray) -> str:
    contiguous = np.ascontiguousarray(array.astype(np.float32, copy=False))
    return hashlib.sha256(contiguous.tobytes()).hexdigest()


def _sync(device: str) -> None:
    if device == "cuda":
        import torch

        if torch.cuda.is_available():
            torch.cuda.synchronize()


if __name__ == "__main__":
    raise SystemExit(main())
