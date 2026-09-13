"""Research-only ByteDance note_model browser-runtime feasibility prep.

This script does not touch production recognition, the frozen evaluation set,
or the frozen 0.2/0.2 verifier policy. It creates a small deterministic golden
fixture set from development/calibration manifests, audits the ByteDance
``note_model`` export surface, and optionally exports a fixed-shape ONNX model
for browser-runtime probing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import traceback
from typing import Iterable

import numpy as np

from compare_step_microphone_frontends_causal_cases import (
    ByteDancePianoTranscriptionProvider,
    _case_audio_path,
    _read_wav,
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
SAMPLE_RATE = 16000

FIXTURE_KINDS = ("correct_strike", "correct_chord", "same_note_retrigger")


def main() -> int:
    args = parse_args()
    policy_artifact = json.loads(args.policy.read_text(encoding="utf-8"))
    _validate_policy(policy_artifact)
    frontend = policy_artifact["frontend"]
    checkpoint_path = _checkpoint_path(frontend)
    checkpoint_sha256 = _sha256(checkpoint_path)
    if checkpoint_sha256 != frontend["checkpoint_sha256"]:
        raise ValueError(
            "checkpoint SHA256 mismatch: "
            f"expected {frontend['checkpoint_sha256']}, got {checkpoint_sha256}"
        )

    output_dir = args.output_dir
    fixture_dir = output_dir / "golden_fixtures"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    cases = _load_cases(args.case_manifest)
    selected = _select_fixture_groups(cases, kinds=args.fixture_kind)

    provider = ByteDancePianoTranscriptionProvider(
        checkpoint_path=checkpoint_path,
        device=args.device,
    )
    _warm_up_note_model(provider, device=args.device)
    model = provider._transcriber.model
    note_model = model.module.note_model if hasattr(model, "module") else model.note_model

    audit = _audit_note_model(note_model, checkpoint_path=checkpoint_path)
    fixtures = _write_golden_fixtures(
        selected,
        provider=provider,
        device=args.device,
        fixture_dir=fixture_dir,
    )

    export_report = None
    if not args.skip_export:
        export_report = _try_export_onnx(
            note_model,
            first_fixture=fixture_dir / fixtures[0]["input_tensor_npy"],
            onnx_path=output_dir / "bytedance_note_model_fixed_anchor.onnx",
            opset=args.opset,
        )
        if export_report.get("status") == "exported":
            export_report["onnxruntime_comparison"] = _compare_onnxruntime(
                onnx_path=Path(export_report["onnx_path"]),
                fixture_dir=fixture_dir,
                fixtures=fixtures,
            )

    report = {
        "scope": "research_only_browser_runtime_feasibility",
        "trigger_research_conclusion": {
            "handcrafted_rms_flux_causal_trigger": "no robust candidate selected",
            "runtime_component_status": "trigger remains unresolved",
        },
        "policy": {
            "path": str(args.policy),
            "checkpoint_sha256": checkpoint_sha256,
            "verifier_onset_threshold": policy_artifact["policy"]["target_onset_min"],
            "verifier_frame_threshold": policy_artifact["policy"]["target_frame_min"],
        },
        "input_contract": {
            "sample_rate": SAMPLE_RATE,
            "channels": 1,
            "target_anchor_ms": TARGET_ANCHOR_MS,
            "real_lookback_ms": REAL_LOOKBACK_MS,
            "future_ms": FUTURE_PREFIX_MS,
            "total_samples_normal_case": int(round((TARGET_ANCHOR_MS + FUTURE_PREFIX_MS) / 1000 * SAMPLE_RATE)),
        },
        "model_audit": audit,
        "fixtures": fixtures,
        "export": export_report,
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--skip-export", action="store_true")
    parser.add_argument("--fixture-kind", action="append", choices=FIXTURE_KINDS, default=None)
    args = parser.parse_args()
    if args.fixture_kind is None:
        args.fixture_kind = list(FIXTURE_KINDS)
    return args


def _load_cases(manifest_paths: Iterable[Path]) -> list[tuple[Path, dict[str, object]]]:
    cases = []
    for manifest_path in manifest_paths:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        cases.extend((manifest_path, case) for case in manifest.get("cases", ()))
    return cases


def _select_fixture_groups(
    cases: list[tuple[Path, dict[str, object]]],
    *,
    kinds: list[str],
) -> list[dict[str, object]]:
    selected = []
    seen = set()
    for wanted_kind in kinds:
        for manifest_path, case in cases:
            if str(case.get("case_kind")) != wanted_kind or wanted_kind in seen:
                continue
            group_index = 1 if wanted_kind == "same_note_retrigger" and len(case.get("expected_groups", ())) > 1 else 0
            selected.append(
                {
                    "manifest_path": manifest_path,
                    "case": case,
                    "group_index": group_index,
                }
            )
            seen.add(wanted_kind)
            break
    missing = [kind for kind in kinds if kind not in seen]
    if missing:
        raise ValueError(f"could not select fixture kinds: {missing}")
    return selected


def _audit_note_model(note_model: object, *, checkpoint_path: Path) -> dict[str, object]:
    children = []
    for name, child in note_model.named_children():
        children.append(
            {
                "name": name,
                "type": f"{type(child).__module__}.{type(child).__qualname__}",
                "parameter_count": int(sum(param.numel() for param in child.parameters(recurse=True))),
            }
        )
    parameter_count = int(sum(param.numel() for param in note_model.parameters()))
    return {
        "checkpoint_path_for_local_run": str(checkpoint_path),
        "checkpoint_size_bytes": checkpoint_path.stat().st_size,
        "checkpoint_sha256": _sha256(checkpoint_path),
        "module_type": f"{type(note_model).__module__}.{type(note_model).__qualname__}",
        "parameter_count": parameter_count,
        "estimated_fp32_parameter_bytes": parameter_count * 4,
        "children": children,
        "browser_export_notes": {
            "preprocessing": "torchlibrosa Spectrogram + LogmelFilterBank are inside note_model; first export attempt keeps preprocessing in the graph.",
            "runtime_candidate": "ONNX Runtime Web WebGPU first; WASM fallback can be measured only if WebGPU is unavailable.",
            "likely_blockers": [
                "torchlibrosa STFT Conv1d graph size and constant kernels",
                "GRU/BiGRU operator support and performance in ORT Web WebGPU",
                "fixed-shape waveform input is preferred over dynamic audio length for this contract",
            ],
        },
    }


def _write_golden_fixtures(
    selected: list[dict[str, object]],
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    fixture_dir: Path,
) -> list[dict[str, object]]:
    fixtures = []
    for selected_item in selected:
        manifest_path = Path(selected_item["manifest_path"])
        case = selected_item["case"]
        group_index = int(selected_item["group_index"])
        audio_path = _case_audio_path(case, manifest_path=manifest_path)
        audio, sample_rate = _read_wav(audio_path)
        if sample_rate != SAMPLE_RATE:
            raise ValueError(f"expected 16 kHz fixture audio, got {sample_rate}")
        clip_audio, clip_meta = _fixed_anchor_clip(case, audio, sample_rate, group_index=group_index)
        raw_output, latency = _direct_note_forward(provider, clip_audio, sample_rate, device=device)
        fixture_id = f"{case['case_id']}_g{group_index + 1:02d}"
        input_name = f"{fixture_id}_input.npy"
        onset_name = f"{fixture_id}_reg_onset_output.npy"
        frame_name = f"{fixture_id}_frame_output.npy"
        velocity_name = f"{fixture_id}_velocity_output.npy"
        np.save(fixture_dir / input_name, clip_audio.astype(np.float32, copy=False))
        np.save(fixture_dir / onset_name, raw_output["onset"].astype(np.float32, copy=False))
        np.save(fixture_dir / frame_name, raw_output["frame"].astype(np.float32, copy=False))
        np.save(fixture_dir / velocity_name, raw_output["velocity"].astype(np.float32, copy=False))
        fixtures.append(
            {
                "fixture_id": fixture_id,
                "case_id": case["case_id"],
                "case_kind": case["case_kind"],
                "group_index": group_index,
                "expected_pitches": case["expected_groups"][group_index],
                "input_tensor_npy": input_name,
                "reg_onset_output_npy": onset_name,
                "frame_output_npy": frame_name,
                "velocity_output_npy": velocity_name,
                "input_sha256": _file_sha256(fixture_dir / input_name),
                "onset_sha256": _file_sha256(fixture_dir / onset_name),
                "frame_sha256": _file_sha256(fixture_dir / frame_name),
                "raw_output_shape": {
                    "reg_onset_output": list(raw_output["onset"].shape),
                    "frame_output": list(raw_output["frame"].shape),
                },
                "forward_ms": latency["forward_ms"],
                **clip_meta,
            }
        )
    (fixture_dir / "manifest.json").write_text(
        json.dumps({"fixtures": fixtures}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return fixtures


def _fixed_anchor_clip(
    case: dict[str, object],
    audio: np.ndarray,
    sample_rate: int,
    *,
    group_index: int,
) -> tuple[np.ndarray, dict[str, object]]:
    source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    target_second = target_seconds[group_index]
    relative_target = max(0.0, target_second - source_start)
    available_real_lookback_seconds = min(REAL_LOOKBACK_MS / 1000.0, relative_target)
    real_start_relative = relative_target - available_real_lookback_seconds
    real_end_relative = min(audio.size / sample_rate, relative_target + FUTURE_PREFIX_MS / 1000.0)
    real_audio = audio[
        int(round(real_start_relative * sample_rate)) : int(round(real_end_relative * sample_rate))
    ]
    zero_pad_seconds = TARGET_ANCHOR_MS / 1000.0 - available_real_lookback_seconds
    if zero_pad_seconds < -1e-9:
        raise ValueError(f"negative zero padding for {case.get('case_id')} group {group_index}")
    zero_pad = np.zeros(int(round(max(0.0, zero_pad_seconds) * sample_rate)), dtype=np.float32)
    clip_audio = np.concatenate([zero_pad, real_audio.astype(np.float32, copy=False)])
    expected_samples = int(round((TARGET_ANCHOR_MS + FUTURE_PREFIX_MS) / 1000.0 * sample_rate))
    if clip_audio.shape[0] != expected_samples:
        raise ValueError(
            f"fixture {case.get('case_id')} group {group_index} has {clip_audio.shape[0]} samples, "
            f"expected {expected_samples}"
        )
    return clip_audio, {
        "target_second": target_second,
        "target_anchor_sample": int(round(TARGET_ANCHOR_MS / 1000.0 * sample_rate)),
        "zero_pad_ms": round(zero_pad_seconds * 1000.0, 6),
        "available_real_lookback_ms": round(available_real_lookback_seconds * 1000.0, 6),
        "future_ms": FUTURE_PREFIX_MS,
        "input_samples": int(clip_audio.shape[0]),
    }


def _try_export_onnx(note_model: object, *, first_fixture: Path, onnx_path: Path, opset: int) -> dict[str, object]:
    try:
        import torch

        class OnsetFrameWrapper(torch.nn.Module):
            def __init__(self, wrapped: object) -> None:
                super().__init__()
                self.wrapped = wrapped

            def forward(self, audio):  # noqa: ANN001
                output = self.wrapped(audio)
                return output["reg_onset_output"], output["frame_output"]

        waveform = np.load(first_fixture).astype(np.float32, copy=False)[None, :]
        model_device = next(note_model.parameters()).device
        dummy = torch.from_numpy(waveform).to(model_device)
        wrapper = OnsetFrameWrapper(note_model).eval()
        onnx_path.parent.mkdir(parents=True, exist_ok=True)
        torch.onnx.export(
            wrapper,
            dummy,
            str(onnx_path),
            input_names=["audio"],
            output_names=["reg_onset_output", "frame_output"],
            opset_version=opset,
            do_constant_folding=True,
            dynamic_axes=None,
        )
        return {
            "status": "exported",
            "onnx_path": str(onnx_path),
            "onnx_size_bytes": onnx_path.stat().st_size,
            "opset": opset,
            "input_shape": list(dummy.shape),
        }
    except Exception as exc:  # pragma: no cover - exercised in research env
        return {
            "status": "failed",
            "error_type": type(exc).__name__,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }


def _compare_onnxruntime(
    *,
    onnx_path: Path,
    fixture_dir: Path,
    fixtures: list[dict[str, object]],
) -> dict[str, object]:
    try:
        import onnxruntime as ort
    except Exception as exc:  # pragma: no cover
        return {"status": "skipped", "reason": f"onnxruntime unavailable: {exc}"}

    try:
        session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        optimization = "default"
    except Exception as default_exc:
        try:
            options = ort.SessionOptions()
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
            session = ort.InferenceSession(
                str(onnx_path),
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
            optimization = "disabled_after_default_load_failed"
        except Exception as disabled_exc:
            return {
                "status": "failed_to_load",
                "default_load_error": str(default_exc),
                "disabled_optimization_load_error": str(disabled_exc),
            }
    comparisons = []
    for fixture in fixtures:
        audio = np.load(fixture_dir / fixture["input_tensor_npy"]).astype(np.float32, copy=False)[None, :]
        onset_ref = np.load(fixture_dir / fixture["reg_onset_output_npy"])
        frame_ref = np.load(fixture_dir / fixture["frame_output_npy"])
        onset, frame = session.run(["reg_onset_output", "frame_output"], {"audio": audio})
        onset = onset[0]
        frame = frame[0]
        comparisons.append(
            {
                "fixture_id": fixture["fixture_id"],
                "onset_shape_equal": list(onset.shape) == list(onset_ref.shape),
                "frame_shape_equal": list(frame.shape) == list(frame_ref.shape),
                "onset_mean_abs_delta": float(np.mean(np.abs(onset - onset_ref))),
                "onset_max_abs_delta": float(np.max(np.abs(onset - onset_ref))),
                "frame_mean_abs_delta": float(np.mean(np.abs(frame - frame_ref))),
                "frame_max_abs_delta": float(np.max(np.abs(frame - frame_ref))),
            }
        )
    return {"status": "compared", "session_optimization": optimization, "comparisons": comparisons}


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
