"""Evaluate Basic Pitch under the fixed-anchor +220ms runtime contract.

This research-only diagnostic closes the contract gap between the browser
latency smoke test and the earlier source-prefix +350ms Basic Pitch accuracy
report. It does not touch the frozen evaluation set, tune thresholds, or modify
production recognition.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
from time import perf_counter

import numpy as np

from compare_step_microphone_frontends_causal_cases import (
    BasicPitchRawActivationProvider,
    _activation_prediction,
    _case_audio_path,
    _case_source_identity,
    _evaluate_expected,
    _future_target_contamination,
    _predict_basic_pitch,
    _read_wav,
    _write_wav,
)


TARGET_ANCHOR_MS = 1600
REAL_LOOKBACK_MS = 1000
FUTURE_PREFIX_MS = 220
LOCAL_PRE_SECONDS = 0.05
LOCAL_POST_SECONDS = 0.12
ONSET_THRESHOLD = 0.5
FRAME_THRESHOLD = 0.3
SAMPLE_RATE = 16_000


def main() -> int:
    args = parse_args()
    cases = [
        (manifest_path, case)
        for manifest_path in args.case_manifest
        for case in json.loads(manifest_path.read_text(encoding="utf-8")).get("cases", ())
    ]
    provider = BasicPitchRawActivationProvider(model_path=args.model_path)
    evaluations = [
        _evaluate_case(
            manifest_path,
            case,
            provider=provider,
            work_dir=args.work_dir,
        )
        for manifest_path, case in cases
    ]
    report = {
        "benchmark_scope": "basic_pitch_fixed_anchor_bounded_window",
        "production_modified": False,
        "frozen_evaluation_used": False,
        "threshold_tuning": False,
        "provider": {
            "provider_id": "basic_pitch_raw_activation",
            "model_path": str(provider.model_path),
        },
        "case_manifests": [str(path) for path in args.case_manifest],
        "case_count": len(cases),
        "input_contract": {
            "source_sample_rate_hz": SAMPLE_RATE,
            "basic_pitch_internal_sample_rate_hz": 22050,
            "resample_method": (
                "Official Basic Pitch Python inference path reads the 16k WAV "
                "and performs its own library resampling before model inference."
            ),
            "target_anchor_ms": TARGET_ANCHOR_MS,
            "max_real_lookback_ms": REAL_LOOKBACK_MS,
            "future_ms": FUTURE_PREFIX_MS,
            "typical_left_zero_padding_ms": TARGET_ANCHOR_MS - REAL_LOOKBACK_MS,
            "total_input_samples_16k": int(round((TARGET_ANCHOR_MS + FUTURE_PREFIX_MS) / 1000 * SAMPLE_RATE)),
        },
        "frame_timing": {
            "mapping": "basic_pitch.note_creation.model_frames_to_time",
            "local_window_seconds": [-LOCAL_PRE_SECONDS, LOCAL_POST_SECONDS],
        },
        "thresholds": {
            "onset": ONSET_THRESHOLD,
            "frame": FRAME_THRESHOLD,
        },
        "summary": {
            "metrics": _metrics_for(evaluations),
            "per_source_metrics": _per_source_metrics(evaluations),
            "no_local_model_frames": _no_local_frame_count(evaluations),
            "latency": _latency_summary(evaluations),
            "fixed_anchor_window": _window_summary(evaluations),
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
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--model-path", type=Path, default=None)
    return parser.parse_args()


def _evaluate_case(
    manifest_path: Path,
    case: dict[str, object],
    *,
    provider: BasicPitchRawActivationProvider,
    work_dir: Path,
) -> dict[str, object]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE}Hz case audio, got {sample_rate}")
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
        available_real_lookback_seconds = min(REAL_LOOKBACK_MS / 1000.0, relative_target)
        real_start_relative = relative_target - available_real_lookback_seconds
        real_end_relative = min(audio_duration_seconds, relative_target + FUTURE_PREFIX_MS / 1000.0)
        real_audio = audio[
            int(round(real_start_relative * sample_rate)) : int(round(real_end_relative * sample_rate))
        ]
        zero_pad_seconds = TARGET_ANCHOR_MS / 1000.0 - available_real_lookback_seconds
        if zero_pad_seconds < -1e-9:
            raise ValueError(f"negative zero padding for {case.get('case_id')} group {index}")
        zero_pad = np.zeros(int(round(max(0.0, zero_pad_seconds) * sample_rate)), dtype=np.float32)
        clip_audio = np.concatenate([zero_pad, real_audio.astype(np.float32, copy=False)])
        expected_samples = int(round((TARGET_ANCHOR_MS + FUTURE_PREFIX_MS) / 1000.0 * sample_rate))
        if clip_audio.size != expected_samples:
            raise ValueError(
                f"{case.get('case_id')} group {index} has {clip_audio.size} samples, "
                f"expected {expected_samples}"
            )
        clip_start_seconds = target_second - TARGET_ANCHOR_MS / 1000.0
        clip_path = (
            work_dir
            / "basic_pitch_fixed_anchor_clips"
            / f"{case['case_id']}_g{index + 1:02d}_anchor{TARGET_ANCHOR_MS}_future{FUTURE_PREFIX_MS}.wav"
        )
        _write_wav(clip_path, clip_audio, sample_rate=sample_rate)

        started = perf_counter()
        raw_output = _predict_basic_pitch(provider, clip_audio, sample_rate=sample_rate, clip_path=clip_path)
        inference_ms = (perf_counter() - started) * 1000.0
        prediction = _activation_prediction(
            raw_output,
            expected_pitches=expected_pitches,
            clip_start_seconds=clip_start_seconds,
            analysis_start_seconds=target_second - LOCAL_PRE_SECONDS,
            analysis_end_seconds=target_second + LOCAL_POST_SECONDS,
            target_second=target_second,
            onset_threshold=ONSET_THRESHOLD,
            frame_threshold=FRAME_THRESHOLD,
        )
        observed = tuple(
            pitch for pitch, evidence in prediction["expected_evidence"].items() if evidence["accepted"]
        )
        result, matched, missing, extra = _evaluate_expected(expected_pitches, observed)
        actual_pitches = actual_groups[index] if index < len(actual_groups) else ()
        contamination = _future_target_contamination(
            case,
            expected_pitches=expected_pitches,
            actual_pitches=actual_pitches,
            target_second=target_second,
            decision_end_seconds=target_second + FUTURE_PREFIX_MS / 1000.0,
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
                "competitor_evidence": prediction["competitor_evidence"],
                "chord_summary": prediction["chord_summary"],
                "future_target_contamination": contamination,
                "fixed_anchor_window": {
                    "target_anchor_ms": TARGET_ANCHOR_MS,
                    "available_real_lookback_ms": round(available_real_lookback_seconds * 1000.0, 3),
                    "zero_pad_ms": round(max(0.0, zero_pad_seconds) * 1000.0, 3),
                    "future_available_ms": round(max(0.0, real_end_relative - relative_target) * 1000.0, 3),
                    "tensor_duration_ms": round((clip_audio.size / sample_rate) * 1000.0, 3),
                },
            }
        )
        latency_samples.append(
            {
                "inference_ms": round(inference_ms, 3),
                "estimated_strike_to_decision_ms": round(FUTURE_PREFIX_MS + inference_ms, 3),
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
            group["future_target_contamination"]["contaminated"] for group in group_results
        ),
        "source_identity": _case_source_identity(case),
        "group_results": group_results,
        "latency_samples": latency_samples,
    }


def _latency_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    inference = [
        float(sample["inference_ms"])
        for evaluation in evaluations
        for sample in evaluation["latency_samples"]
    ]
    estimated = [
        float(sample["estimated_strike_to_decision_ms"])
        for evaluation in evaluations
        for sample in evaluation["latency_samples"]
    ]
    return {
        "python_basic_pitch_inference_ms": _distribution(inference),
        "estimated_strike_to_decision_ms": _distribution(estimated),
        "sample_count": len(inference),
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


def _rate(evaluations: object) -> dict[str, object]:
    items = tuple(evaluations)
    accepted = sum(1 for evaluation in items if bool(evaluation["accepted"]))
    total = len(items)
    return {"accepted": accepted, "total": total, "rate": round(accepted / total, 6) if total else None}


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


def _window_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    zero_pad = []
    available = []
    for evaluation in evaluations:
        for group in evaluation["group_results"]:
            window = group["fixed_anchor_window"]
            zero_pad.append(float(window["zero_pad_ms"]))
            available.append(float(window["available_real_lookback_ms"]))
    return {
        "zero_pad_ms": _distribution(zero_pad),
        "available_real_lookback_ms": _distribution(available),
    }


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


if __name__ == "__main__":
    raise SystemExit(main())
