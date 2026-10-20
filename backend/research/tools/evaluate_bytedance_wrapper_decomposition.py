"""Decompose ByteDance/Kong inference wrapper cost on a deterministic sample.

This research-only script does not tune policy thresholds and does not use the
frozen evaluation set. It compares the official transcribe wrapper with direct
model-forward variants on the same development/calibration clips.
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
    _read_wav,
    _write_wav,
)


PATHS = (
    "A_official_transcribe",
    "B_direct_full_model_padded_10s",
    "C_direct_note_model_padded_10s",
    "D_direct_note_model_actual_prefix",
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

    cases = [
        (path, case)
        for path in args.case_manifest
        for case in json.loads(path.read_text(encoding="utf-8")).get("cases", ())
    ][: args.max_cases]

    device_reports = {}
    for device in args.device:
        provider = ByteDancePianoTranscriptionProvider(
            checkpoint_path=checkpoint_path,
            device=device,
        )
        examples = [
            _evaluate_case(
                manifest_path,
                case,
                provider=provider,
                device=device,
                prefix_ms=args.prefix_ms,
                work_dir=args.work_dir,
                local_pre_seconds=float(window["local_pre_seconds"]),
                local_post_seconds=float(window["local_post_seconds"]),
                onset_threshold=float(policy["target_onset_min"]),
                frame_threshold=float(policy["target_frame_min"]),
            )
            for manifest_path, case in cases
        ]
        device_reports[device] = _summarize_device(examples)

    report = {
        "benchmark_scope": "bytedance_inference_wrapper_decomposition",
        "frozen_evaluation_used": False,
        "production_modified": False,
        "grid_search": False,
        "policy_reselected": False,
        "policy_artifact": str(args.policy),
        "case_manifests": [str(path) for path in args.case_manifest],
        "case_count": len(cases),
        "prefix_ms": args.prefix_ms,
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
    parser.add_argument("--max-cases", type=int, default=12)
    parser.add_argument("--prefix-ms", type=int, default=350)
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
    prefix_ms: int,
    work_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[str, object]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    if sample_rate != 16000:
        raise ValueError(f"expected 16 kHz audio, got {sample_rate}")
    source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    if not target_seconds or not expected_groups:
        raise ValueError(f"case has no target groups: {case.get('case_id')}")
    target_second = target_seconds[0]
    relative_target = max(0.0, target_second - source_start)
    clip_end_seconds = min(audio.size / sample_rate, relative_target + prefix_ms / 1000.0)
    clip_audio = audio[: int(round(clip_end_seconds * sample_rate))]
    clip_path = (
        work_dir
        / f"wrapper_decomposition_{device}"
        / f"{case['case_id']}_prefix{prefix_ms}.wav"
    )
    _write_wav(clip_path, clip_audio, sample_rate=sample_rate)

    path_outputs = {
        "A_official_transcribe": _run_official_transcribe(provider, clip_audio, sample_rate, device),
        "B_direct_full_model_padded_10s": _run_direct_forward(
            provider,
            clip_audio,
            sample_rate,
            device,
            use_note_only=False,
            pad_to_segment=True,
        ),
        "C_direct_note_model_padded_10s": _run_direct_forward(
            provider,
            clip_audio,
            sample_rate,
            device,
            use_note_only=True,
            pad_to_segment=True,
        ),
        "D_direct_note_model_actual_prefix": _run_direct_forward(
            provider,
            clip_audio,
            sample_rate,
            device,
            use_note_only=True,
            pad_to_segment=False,
        ),
    }

    expected_pitches = expected_groups[0]
    evaluated_paths = {}
    for path_name, path_output in path_outputs.items():
        prediction = _activation_prediction(
            path_output["raw_output"],
            expected_pitches=expected_pitches,
            clip_start_seconds=source_start,
            analysis_start_seconds=target_second - local_pre_seconds,
            analysis_end_seconds=target_second + local_post_seconds,
            target_second=target_second,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
        )
        accepted = all(
            bool(evidence["accepted"])
            for evidence in prediction["expected_evidence"].values()
        )
        evaluated_paths[path_name] = {
            **path_output["metadata"],
            "accepted": accepted,
            "expected_evidence": prediction["expected_evidence"],
            "chord_summary": prediction["chord_summary"],
        }

    return {
        "case_id": case.get("case_id"),
        "case_kind": case.get("case_kind"),
        "expected_pitches": expected_pitches,
        "paths": evaluated_paths,
    }


def _run_official_transcribe(
    provider: ByteDancePianoTranscriptionProvider,
    clip_audio: np.ndarray,
    sample_rate: int,
    device: str,
) -> dict[str, object]:
    del sample_rate
    _reset_peak_memory(device)
    _sync(device)
    started = perf_counter()
    result = provider._transcriber.transcribe(clip_audio, midi_path=None)
    _sync(device)
    wall_seconds = perf_counter() - started
    raw = _normalize_raw_output(result["output_dict"])
    return {
        "raw_output": raw,
        "metadata": {
            "wall_ms": round(wall_seconds * 1000.0, 3),
            "input_real_seconds": round(clip_audio.size / 16000.0, 6),
            "tensor_seconds_fed": 10.0,
            "output_frame_count": int(raw["onset"].shape[0]),
            "peak_gpu_memory_bytes": _peak_memory(device),
        },
    }


def _run_direct_forward(
    provider: ByteDancePianoTranscriptionProvider,
    clip_audio: np.ndarray,
    sample_rate: int,
    device: str,
    *,
    use_note_only: bool,
    pad_to_segment: bool,
) -> dict[str, object]:
    import torch
    from piano_transcription_inference.inference import move_data_to_device

    if sample_rate != 16000:
        raise ValueError(f"expected 16 kHz audio, got {sample_rate}")
    audio = clip_audio.astype(np.float32, copy=False)
    if pad_to_segment:
        segment_samples = int(provider._transcriber.segment_samples)
        pad_len = int(np.ceil(audio.size / segment_samples)) * segment_samples - audio.size
        audio = np.concatenate((audio, np.zeros(pad_len, dtype=np.float32)))
    batch = audio[None, :]
    model = provider._transcriber.model
    if use_note_only:
        model = model.module.note_model if hasattr(model, "module") else model.note_model
    _reset_peak_memory(device)
    _sync(device)
    started = perf_counter()
    tensor = move_data_to_device(batch, next(model.parameters()).device)
    with torch.no_grad():
        model.eval()
        output = model(tensor)
    _sync(device)
    wall_seconds = perf_counter() - started
    raw = _normalize_raw_output(
        {
            key: value.detach().cpu().numpy()[0]
            for key, value in output.items()
            if key in {"reg_onset_output", "frame_output", "velocity_output"}
        }
    )
    return {
        "raw_output": raw,
        "metadata": {
            "wall_ms": round(wall_seconds * 1000.0, 3),
            "input_real_seconds": round(clip_audio.size / sample_rate, 6),
            "tensor_seconds_fed": round(audio.size / sample_rate, 6),
            "output_frame_count": int(raw["onset"].shape[0]),
            "peak_gpu_memory_bytes": _peak_memory(device),
        },
    }


def _normalize_raw_output(output: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    onset = output.get("reg_onset_output")
    frame = output.get("frame_output")
    velocity = output.get("velocity_output")
    if onset is None or frame is None:
        raise ValueError("raw output must contain reg_onset_output and frame_output")
    return {
        "onset": np.asarray(onset),
        "frame": np.asarray(frame),
        "velocity": None if velocity is None else np.asarray(velocity),
    }


def _summarize_device(examples: list[dict[str, object]]) -> dict[str, object]:
    by_path: dict[str, list[dict[str, object]]] = defaultdict(list)
    for example in examples:
        for path_name, path_result in example["paths"].items():
            by_path[path_name].append(path_result)
    reference = "A_official_transcribe"
    return {
        "paths": {
            path_name: _path_summary(path_name, path_results, examples, reference=reference)
            for path_name, path_results in by_path.items()
        },
        "examples": examples,
    }


def _path_summary(
    path_name: str,
    path_results: list[dict[str, object]],
    examples: list[dict[str, object]],
    *,
    reference: str,
) -> dict[str, object]:
    deltas_onset = []
    deltas_frame = []
    agreements = 0
    if path_name != reference:
        for example in examples:
            current = example["paths"][path_name]
            ref = example["paths"][reference]
            agreements += int(bool(current["accepted"]) == bool(ref["accepted"]))
            for pitch, evidence in current["expected_evidence"].items():
                ref_evidence = ref["expected_evidence"][pitch]
                _append_delta(deltas_onset, evidence, ref_evidence, "onset_activation")
                _append_delta(deltas_frame, evidence, ref_evidence, "frame_activation")
    return {
        "accepted": _rate(bool(result["accepted"]) for result in path_results),
        "decision_agreement_with_A": {
            "accepted": agreements,
            "total": len(path_results),
            "rate": round(agreements / len(path_results), 6)
            if path_results and path_name != reference
            else 1.0,
        },
        "wall_ms": _distribution([float(result["wall_ms"]) for result in path_results]),
        "input_real_seconds": _distribution(
            [float(result["input_real_seconds"]) for result in path_results]
        ),
        "tensor_seconds_fed": _distribution(
            [float(result["tensor_seconds_fed"]) for result in path_results]
        ),
        "output_frame_count": _distribution(
            [float(result["output_frame_count"]) for result in path_results]
        ),
        "peak_gpu_memory_bytes": _distribution(
            [
                float(result["peak_gpu_memory_bytes"])
                for result in path_results
                if result["peak_gpu_memory_bytes"] is not None
            ]
        ),
        "activation_delta_vs_A": {
            "onset_abs_mean": _mean_abs(deltas_onset),
            "onset_abs_max": _max_abs(deltas_onset),
            "frame_abs_mean": _mean_abs(deltas_frame),
            "frame_abs_max": _max_abs(deltas_frame),
        },
    }


def _rate(values: object) -> dict[str, object]:
    items = tuple(values)
    accepted = sum(1 for value in items if value)
    total = len(items)
    return {
        "accepted": accepted,
        "total": total,
        "rate": round(accepted / total, 6) if total else None,
    }


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


def _reset_peak_memory(device: str) -> None:
    if device == "cuda":
        import torch

        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()


def _peak_memory(device: str) -> int | None:
    if device != "cuda":
        return None
    import torch

    return int(torch.cuda.max_memory_allocated()) if torch.cuda.is_available() else None


def _validate_policy(policy_artifact: dict[str, object]) -> None:
    policy = policy_artifact.get("policy") or {}
    if policy.get("frame_key") != "frame_activation":
        raise ValueError("wrapper decomposition only supports frame_activation")
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


if __name__ == "__main__":
    raise SystemExit(main())
