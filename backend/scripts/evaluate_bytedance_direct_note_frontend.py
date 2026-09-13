"""Validate ByteDance direct note_model actual-prefix frontend on dev/cal cases.

This research-only benchmark does not touch the frozen evaluation set and does
not tune thresholds. It compares direct note_model bounded-prefix decisions
against existing official-wrapper +350 ms reports rescored with the frozen
verifier policy.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
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
    _write_wav,
)


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

    official_reference = _load_official_reference(
        args.official_report,
        onset_threshold=float(policy["target_onset_min"]),
        frame_threshold=float(policy["target_frame_min"]),
    )
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
        evaluations = [
            _evaluate_case(
                manifest_path,
                case,
                provider=provider,
                device=device,
                work_dir=args.work_dir,
                prefix_ms=350,
                local_pre_seconds=float(window["local_pre_seconds"]),
                local_post_seconds=float(window["local_post_seconds"]),
                decision_horizon_seconds=float(window["decision_horizon_seconds"]),
                onset_threshold=float(policy["target_onset_min"]),
                frame_threshold=float(policy["target_frame_min"]),
            )
            for manifest_path, case in cases
        ]
        device_reports[device] = {
            "metrics": _metrics_for(evaluations),
            "per_source_metrics": _per_source_metrics(evaluations),
            "no_local_model_frames": _no_local_frame_count(evaluations),
            "latency": _latency_summary(evaluations),
            "official_decision_agreement": _agreement_summary(
                evaluations,
                official_reference,
            ),
            "disagreements": _disagreements(evaluations, official_reference),
            "evaluations": evaluations,
        }

    report = {
        "benchmark_scope": "bytedance_direct_note_actual_prefix_frontend_validation",
        "frozen_evaluation_used": False,
        "production_modified": False,
        "grid_search": False,
        "policy_reselected": False,
        "policy_artifact": str(args.policy),
        "case_manifests": [str(path) for path in args.case_manifest],
        "official_reference_reports": [str(path) for path in args.official_report],
        "case_count": len(cases),
        "checkpoint_sha256": checkpoint_sha256,
        "policy": policy,
        "benchmark_window": window,
        "frontend_semantics": {
            "input": "bounded prefix through target +350ms",
            "model": "ByteDance note_model only",
            "padding_to_10s": False,
            "pedal_model": False,
            "postprocessing": False,
            "midi_decoding": False,
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
    parser.add_argument("--official-report", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--device", action="append", default=None)
    args = parser.parse_args()
    if args.device is None:
        args.device = ["cuda"]
    return args


def _load_official_reference(
    report_paths: list[Path],
    *,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[tuple[str, str], dict[str, object]]:
    references = {}
    for report_path in report_paths:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        evaluations = report["frontends"]["bytedance_high_resolution_piano_transcription"][
            "evaluations"
        ]
        for evaluation in evaluations:
            rescored = _rescore_existing_evaluation(
                evaluation,
                onset_threshold=onset_threshold,
                frame_threshold=frame_threshold,
            )
            references[_evaluation_key(rescored)] = rescored
    return references


def _rescore_existing_evaluation(
    evaluation: dict[str, object],
    *,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[str, object]:
    group_results = []
    for group in evaluation["group_results"]:
        observed = tuple(
            pitch
            for pitch, evidence in group["expected_evidence"].items()
            if _evidence_accepted(evidence, onset_threshold, frame_threshold)
        )
        expected_pitches = tuple(group["expected_pitches"])
        result, matched, missing, extra = _evaluate_expected(expected_pitches, observed)
        group_results.append(
            {
                **group,
                "observed_pitches": observed,
                "result": result,
                "matched_expected": matched,
                "missing_expected": missing,
                "extra_observed": extra,
            }
        )
    expected_advances = int(evaluation.get("expected_advances", 0))
    matched_groups = sum(1 for group in group_results if group["result"] == "MATCH")
    accepted = matched_groups > 0 if expected_advances == 0 else matched_groups >= expected_advances
    return {
        **evaluation,
        "matched_groups": matched_groups,
        "accepted": accepted,
        "group_results": group_results,
    }


def _evaluate_case(
    manifest_path: Path,
    case: dict[str, object],
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    work_dir: Path,
    prefix_ms: int,
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
    for index, expected_pitches in enumerate(expected_groups):
        target_second = target_seconds[index]
        relative_target = max(0.0, target_second - source_start)
        clip_end_seconds = min(audio.size / sample_rate, relative_target + prefix_ms / 1000.0)
        clip_audio = audio[: int(round(clip_end_seconds * sample_rate))]
        clip_path = (
            work_dir
            / f"bytedance_direct_note_{device}"
            / (
                f"{case['case_id']}_g{index + 1:02d}"
                f"_prefix{prefix_ms}_local{_safe_float(local_pre_seconds)}-"
                f"{_safe_float(local_post_seconds)}.wav"
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
            clip_start_seconds=source_start,
            analysis_start_seconds=target_second - local_pre_seconds,
            analysis_end_seconds=target_second + local_post_seconds,
            target_second=target_second,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
        )
        _sync(device)
        end_to_end_ms = (perf_counter() - end_to_end_started) * 1000.0
        latency_samples.append(
            {
                "forward_ms": round(forward_latency["forward_ms"], 3),
                "target_evidence_end_to_end_ms": round(end_to_end_ms, 3),
            }
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


def _direct_note_forward(
    provider: ByteDancePianoTranscriptionProvider,
    clip_audio: np.ndarray,
    sample_rate: int,
    *,
    device: str,
) -> tuple[dict[str, np.ndarray], dict[str, float]]:
    import torch
    from piano_transcription_inference.inference import move_data_to_device

    if sample_rate != 16000:
        raise ValueError(f"expected 16 kHz audio, got {sample_rate}")
    model = provider._transcriber.model
    note_model = model.module.note_model if hasattr(model, "module") else model.note_model
    batch = clip_audio.astype(np.float32, copy=False)[None, :]
    _sync(device)
    forward_started = perf_counter()
    tensor = move_data_to_device(batch, next(note_model.parameters()).device)
    with torch.no_grad():
        note_model.eval()
        output = note_model(tensor)
    _sync(device)
    forward_ms = (perf_counter() - forward_started) * 1000.0
    raw_output = {
        "onset": output["reg_onset_output"].detach().cpu().numpy()[0],
        "frame": output["frame_output"].detach().cpu().numpy()[0],
        "velocity": output["velocity_output"].detach().cpu().numpy()[0],
    }
    return raw_output, {"forward_ms": forward_ms}


def _warm_up_note_model(provider: ByteDancePianoTranscriptionProvider, *, device: str) -> None:
    sample_rate = 16000
    silence = np.zeros(int(sample_rate * 0.5), dtype=np.float32)
    _direct_note_forward(provider, silence, sample_rate, device=device)


def _agreement_summary(
    evaluations: list[dict[str, object]],
    official_reference: dict[tuple[str, str], dict[str, object]],
) -> dict[str, object]:
    total = 0
    agreed = 0
    for evaluation in evaluations:
        reference = official_reference[_evaluation_key(evaluation)]
        total += 1
        agreed += int(bool(evaluation["accepted"]) == bool(reference["accepted"]))
    return {"accepted": agreed, "total": total, "rate": round(agreed / total, 6)}


def _disagreements(
    evaluations: list[dict[str, object]],
    official_reference: dict[tuple[str, str], dict[str, object]],
) -> list[dict[str, object]]:
    rows = []
    for evaluation in evaluations:
        reference = official_reference[_evaluation_key(evaluation)]
        if bool(evaluation["accepted"]) == bool(reference["accepted"]):
            continue
        rows.append(
            {
                "source_recording_id": evaluation["source_identity"]["source_recording_id"],
                "case_id": evaluation["case_id"],
                "case_kind": evaluation["case_kind"],
                "official_decision": bool(reference["accepted"]),
                "direct_note_decision": bool(evaluation["accepted"]),
                "evidence_delta": _evidence_delta(evaluation, reference),
            }
        )
    return rows


def _evidence_delta(
    evaluation: dict[str, object],
    reference: dict[str, object],
) -> dict[str, object]:
    onset_deltas = []
    frame_deltas = []
    for group, reference_group in zip(
        evaluation["group_results"],
        reference["group_results"],
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


def _latency_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    forward = []
    end_to_end = []
    for evaluation in evaluations:
        for sample in evaluation["latency_samples"]:
            forward.append(float(sample["forward_ms"]))
            end_to_end.append(float(sample["target_evidence_end_to_end_ms"]))
    return {
        "note_model_forward_ms": _distribution(forward),
        "target_evidence_end_to_end_ms": _distribution(end_to_end),
        "sample_count": len(forward),
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


def _evidence_accepted(
    evidence: dict[str, object],
    onset_threshold: float,
    frame_threshold: float,
) -> bool:
    onset = evidence.get("onset_activation")
    frame = evidence.get("frame_activation")
    return (
        isinstance(onset, (int, float))
        and isinstance(frame, (int, float))
        and float(onset) >= onset_threshold
        and float(frame) >= frame_threshold
    )


def _rate(evaluations: object) -> dict[str, object]:
    items = tuple(evaluations)
    accepted = sum(1 for evaluation in items if bool(evaluation["accepted"]))
    total = len(items)
    return {"accepted": accepted, "total": total, "rate": round(accepted / total, 6) if total else None}


def _distribution(values: list[float]) -> dict[str, object]:
    if not values:
        return {"mean": None, "median": None, "p95": None}
    ordered = sorted(values)
    p95_index = min(len(ordered) - 1, int(np.ceil(len(ordered) * 0.95)) - 1)
    return {
        "mean": round(float(np.mean(ordered)), 6),
        "median": round(float(np.median(ordered)), 6),
        "p95": round(float(ordered[p95_index]), 6),
    }


def _evaluation_key(evaluation: dict[str, object]) -> tuple[str, str]:
    return str(evaluation["source_identity"]["source_recording_id"]), str(evaluation["case_id"])


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


def _validate_policy(policy_artifact: dict[str, object]) -> None:
    policy = policy_artifact.get("policy") or {}
    if policy.get("frame_key") != "frame_activation":
        raise ValueError("direct-note validation only supports frame_activation")
    if float(policy.get("target_onset_min")) != 0.2:
        raise ValueError("expected frozen onset threshold 0.2")
    if float(policy.get("target_frame_min")) != 0.2:
        raise ValueError("expected frozen frame threshold 0.2")
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
