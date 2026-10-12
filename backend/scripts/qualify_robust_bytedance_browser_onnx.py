#!/usr/bin/env python3
"""Research-only Robust ByteDance ONNX export and parity helper.

This script deliberately uses only non-blind public-proxy/development audio and
requires complete real 1820 ms input windows. It does not pad missing context.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
import wave

import numpy as np


EXPECTED_CHECKPOINT_SHA256 = "b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e"
EXPECTED_CHECKPOINT_BYTES = 103815845
SAMPLE_RATE = 16000
INPUT_MS = 1820
INPUT_SAMPLES = 29120
ONSET_THRESHOLD = 0.30
FRAME_THRESHOLD = 0.05
MIDI_OFFSET = 21


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_float32(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array.astype(np.float32, copy=False)).tobytes()).hexdigest()


def read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        sample_width = wav.getsampwidth()
        frames = wav.getnframes()
        raw = wav.readframes(frames)
    if sample_width == 2:
        audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif sample_width == 4:
        audio = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"unsupported WAV sample width {sample_width}: {path}")
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio.astype(np.float32, copy=False), sample_rate


def resample_linear(audio: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate == target_rate:
        return audio.astype(np.float32, copy=False)
    target_len = int(round(audio.shape[0] * target_rate / source_rate))
    if target_len <= 1:
        raise ValueError("cannot resample empty/near-empty audio")
    old_x = np.arange(audio.shape[0], dtype=np.float64)
    new_x = np.linspace(0, audio.shape[0] - 1, target_len, dtype=np.float64)
    return np.interp(new_x, old_x, audio.astype(np.float64)).astype(np.float32)


def select_nonblind_vienna_windows(root: Path, count: int) -> list[dict[str, object]]:
    audio_root = root / "backend" / "data" / "work" / "public_proxy" / "vienna-4x22" / "audio-extracted" / "audio"
    if not audio_root.exists():
        raise FileNotFoundError(f"missing Vienna audio root: {audio_root}")
    performer_pattern = re.compile(r"_p(0[7-9]|1[0-4])(?:\D|$)")
    blind_pattern = re.compile(r"_p(1[5-9]|2[0-2])(?:\D|$)")
    for path in sorted(audio_root.rglob("*.wav")):
        rel = path.relative_to(root).as_posix()
        if blind_pattern.search(rel):
            continue
        if not performer_pattern.search(rel):
            continue
        audio, sample_rate = read_wav_mono(path)
        duration_ms = audio.shape[0] / sample_rate * 1000.0
        required_end_ms = 2000.0 + (count - 1) * 600.0 + INPUT_MS
        if duration_ms < required_end_ms:
            continue
        source_sha = sha256_file(path)
        selected: list[dict[str, object]] = []
        for index in range(count):
            input_start_ms = 2000.0 + index * 600.0
            input_end_ms = input_start_ms + INPUT_MS
            start_sample = int(round(input_start_ms / 1000.0 * sample_rate))
            end_sample = int(round(input_end_ms / 1000.0 * sample_rate))
            if start_sample < 0 or end_sample > audio.shape[0]:
                raise ValueError(f"fixture would require missing source audio: {rel}")
            region = resample_linear(audio[start_sample:end_sample], sample_rate, SAMPLE_RATE)
            if region.shape[0] != INPUT_SAMPLES:
                if region.shape[0] < INPUT_SAMPLES:
                    raise ValueError(f"fixture would require padding: {rel}")
                region = region[:INPUT_SAMPLES]
            fixture_id = f"robust_chronological_{index + 1:02d}"
            commit_start_ms = input_start_ms + 1000.0
            commit_end_ms = commit_start_ms + 600.0
            selected.append(
                {
                    "fixture_id": fixture_id,
                    "sequenceIndex": index,
                    "source_audio_relpath": rel,
                    "source_audio_sha256": source_sha,
                    "source_sample_rate": sample_rate,
                    "source_duration_ms": round(duration_ms, 6),
                    "input_start_source_ms": input_start_ms,
                    "input_end_source_ms": input_end_ms,
                    "commit_start_source_ms": commit_start_ms,
                    "commit_end_source_ms": commit_end_ms,
                    "future_context_ms": round(input_end_ms - commit_end_ms, 6),
                    "input_samples": int(region.shape[0]),
                    "no_fake_zero_padding": True,
                    "pcm": region,
                }
            )
        return selected
    raise RuntimeError(f"no non-blind Vienna source could provide {count} complete chronological Robust windows")


def load_model(checkpoint_path: Path, device: str):
    import torch
    from piano_transcription_inference.models import Regress_onset_offset_frame_velocity_CRNN

    note_model = Regress_onset_offset_frame_velocity_CRNN(
        frames_per_second=100,
        classes_num=88,
    )
    checkpoint = torch.load(str(checkpoint_path), map_location=device, weights_only=False)
    note_model.load_state_dict(checkpoint["model"])
    note_model.to(device)
    note_model.eval()
    return note_model


def run_torch(note_model, pcm: np.ndarray, device: str) -> tuple[dict[str, np.ndarray], float]:
    import torch

    with torch.no_grad():
        tensor = torch.from_numpy(pcm.astype(np.float32, copy=False)).unsqueeze(0).to(device)
        started = time.perf_counter()
        outputs = note_model(tensor)
        if device == "cuda":
            torch.cuda.synchronize()
        elapsed_ms = (time.perf_counter() - started) * 1000.0
    return (
        {
            "reg_onset_output": outputs["reg_onset_output"][0].detach().cpu().numpy().astype(np.float32, copy=False),
            "frame_output": outputs["frame_output"][0].detach().cpu().numpy().astype(np.float32, copy=False),
        },
        elapsed_ms,
    )


def export_onnx(note_model, onnx_path: Path, opset: int) -> dict[str, object]:
    import torch

    class NoteOnlyWrapper(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, audio):
            output = self.inner(audio)
            return output["reg_onset_output"], output["frame_output"]

    dummy = torch.zeros(1, INPUT_SAMPLES, dtype=torch.float32)
    onnx_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        NoteOnlyWrapper(note_model.cpu()).eval(),
        dummy,
        str(onnx_path),
        input_names=["audio"],
        output_names=["reg_onset_output", "frame_output"],
        dynamic_axes=None,
        opset_version=opset,
    )
    return {
        "path": onnx_path.as_posix(),
        "byteSize": onnx_path.stat().st_size,
        "sha256": sha256_file(onnx_path),
        "opset": opset,
        "input": {"name": "audio", "shape": [1, INPUT_SAMPLES], "dtype": "float32"},
        "outputs": [
            {"name": "reg_onset_output", "shape": [1, None, 88], "dtype": "float32"},
            {"name": "frame_output", "shape": [1, None, 88], "dtype": "float32"},
        ],
    }


def run_ort(onnx_path: Path, pcm: np.ndarray, graph_optimization: str) -> tuple[dict[str, np.ndarray], dict[str, object]]:
    import onnxruntime as ort

    options = ort.SessionOptions()
    if graph_optimization == "disabled":
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    started_load = time.perf_counter()
    session = ort.InferenceSession(str(onnx_path), sess_options=options, providers=["CPUExecutionProvider"])
    load_ms = (time.perf_counter() - started_load) * 1000.0
    started = time.perf_counter()
    outputs = session.run(["reg_onset_output", "frame_output"], {"audio": pcm.reshape(1, -1).astype(np.float32)})
    inference_ms = (time.perf_counter() - started) * 1000.0
    return (
        {
            "reg_onset_output": outputs[0][0].astype(np.float32, copy=False),
            "frame_output": outputs[1][0].astype(np.float32, copy=False),
        },
        {
            "version": ort.__version__,
            "providers": session.get_providers(),
            "graphOptimizationLevel": graph_optimization,
            "modelLoadMs": load_ms,
            "inferenceMs": inference_ms,
        },
    )


def compare_arrays(a: np.ndarray, b: np.ndarray) -> dict[str, object]:
    if a.shape != b.shape:
        return {"shapeEqual": False, "aShape": list(a.shape), "bShape": list(b.shape)}
    delta = np.abs(a.astype(np.float64) - b.astype(np.float64))
    return {
        "shapeEqual": True,
        "shape": list(a.shape),
        "meanAbsDelta": float(delta.mean()),
        "maxAbsDelta": float(delta.max()),
        "p95AbsDelta": float(np.percentile(delta, 95)),
    }


def threshold_mask_parity(a: dict[str, np.ndarray], b: dict[str, np.ndarray]) -> dict[str, object]:
    onset_a = a["reg_onset_output"] >= ONSET_THRESHOLD
    onset_b = b["reg_onset_output"] >= ONSET_THRESHOLD
    frame_a = a["frame_output"] >= FRAME_THRESHOLD
    frame_b = b["frame_output"] >= FRAME_THRESHOLD
    return {
        "onsetThreshold": ONSET_THRESHOLD,
        "frameThreshold": FRAME_THRESHOLD,
        "onsetMaskEqual": bool(np.array_equal(onset_a, onset_b)),
        "frameMaskEqual": bool(np.array_equal(frame_a, frame_b)),
        "onsetMismatchCount": int(np.count_nonzero(onset_a != onset_b)),
        "frameMismatchCount": int(np.count_nonzero(frame_a != frame_b)),
    }


def decode_events(raw: dict[str, np.ndarray]) -> list[dict[str, object]]:
    onset = raw["reg_onset_output"]
    frame = raw["frame_output"]
    events: list[dict[str, object]] = []
    for frame_index in range(onset.shape[0]):
        active = np.nonzero((onset[frame_index] >= ONSET_THRESHOLD) & (frame[frame_index] >= FRAME_THRESHOLD))[0]
        for pitch_index in active.tolist():
            events.append(
                {
                    "pitch": int(pitch_index + MIDI_OFFSET),
                    "onsetFrame": int(frame_index),
                    "onsetTimeMs": round(frame_index * 10.0, 6),
                }
            )
    return events


def compare_raw(ref: dict[str, np.ndarray], actual: dict[str, np.ndarray]) -> dict[str, object]:
    ref_events = decode_events(ref)
    actual_events = decode_events(actual)
    return {
        "reg_onset_output": compare_arrays(ref["reg_onset_output"], actual["reg_onset_output"]),
        "frame_output": compare_arrays(ref["frame_output"], actual["frame_output"]),
        "thresholdMaskParityAtOnset030Frame005": threshold_mask_parity(ref, actual),
        "decodedEventParityAtOnset030Frame005": ref_events == actual_events,
        "referenceDecodedEventCount": len(ref_events),
        "actualDecodedEventCount": len(actual_events),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reports-dir", required=True)
    parser.add_argument("--fixture-count", type=int, default=3)
    parser.add_argument("--opset", type=int, default=18)
    parser.add_argument("--try-cuda", action="store_true")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    checkpoint_path = (repo_root / args.checkpoint).resolve()
    output_dir = (repo_root / args.output_dir).resolve()
    fixture_dir = output_dir / "browser_fixtures"
    reports_dir = (repo_root / args.reports_dir).resolve()
    fixture_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    checkpoint_identity = {
        "path": checkpoint_path.relative_to(repo_root).as_posix(),
        "byteSize": checkpoint_path.stat().st_size,
        "sha256": sha256_file(checkpoint_path),
        "expectedByteSize": EXPECTED_CHECKPOINT_BYTES,
        "expectedSha256": EXPECTED_CHECKPOINT_SHA256,
    }
    if checkpoint_identity["byteSize"] != EXPECTED_CHECKPOINT_BYTES or checkpoint_identity["sha256"] != EXPECTED_CHECKPOINT_SHA256:
        raise SystemExit(f"Robust checkpoint identity mismatch: {checkpoint_identity}")

    fixtures = select_nonblind_vienna_windows(repo_root, args.fixture_count)
    cpu_model = load_model(checkpoint_path, "cpu")
    first_pcm = fixtures[0]["pcm"]
    onnx_path = output_dir / f"robust_bytedance_fixed_1820_opset{args.opset}.onnx"
    export_identity = export_onnx(cpu_model, onnx_path, args.opset)
    cpu_model = load_model(checkpoint_path, "cpu")

    fixture_rows = []
    cpu_outputs = []
    for fixture in fixtures:
        raw, latency_ms = run_torch(cpu_model, fixture["pcm"], "cpu")
        cpu_outputs.append(raw)
        input_name = f"{fixture['fixture_id']}_input.npy"
        onset_name = f"{fixture['fixture_id']}_reg_onset_output.npy"
        frame_name = f"{fixture['fixture_id']}_frame_output.npy"
        decoded_name = f"{fixture['fixture_id']}_decoded_events.json"
        np.save(fixture_dir / input_name, fixture["pcm"].astype(np.float32, copy=False))
        np.save(fixture_dir / onset_name, raw["reg_onset_output"].astype(np.float32, copy=False))
        np.save(fixture_dir / frame_name, raw["frame_output"].astype(np.float32, copy=False))
        (fixture_dir / decoded_name).write_text(json.dumps(decode_events(raw), indent=2), encoding="utf-8")
        row = {key: value for key, value in fixture.items() if key != "pcm"}
        row.update(
            {
                "input_tensor_npy": input_name,
                "reg_onset_output_npy": onset_name,
                "frame_output_npy": frame_name,
                "decoded_events_json": decoded_name,
                "inputPcmSha256": sha256_float32(fixture["pcm"]),
                "regOnsetFloat32Sha256": sha256_float32(raw["reg_onset_output"]),
                "frameFloat32Sha256": sha256_float32(raw["frame_output"]),
                "torchCpuForwardMs": latency_ms,
                "decodedEventCountAtOnset030Frame005": len(decode_events(raw)),
            }
        )
        fixture_rows.append(row)

    manifest = {
        "schemaVersion": 1,
        "candidateId": "bytedance-robust-augmented-calibrated-v1",
        "profileId": "CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05",
        "sampleRateHz": SAMPLE_RATE,
        "inputMs": INPUT_MS,
        "inputSamples": INPUT_SAMPLES,
        "onsetThreshold": ONSET_THRESHOLD,
        "frameThreshold": FRAME_THRESHOLD,
        "noFakeZeroPadding": True,
        "fixtures": fixture_rows,
    }
    (fixture_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    ort_results = []
    ort_status = {"status": "NOT_RUN"}
    try:
        for fixture, cpu_raw in zip(fixtures, cpu_outputs):
            ort_raw, ort_meta = run_ort(onnx_path, fixture["pcm"], "default")
            ort_results.append({"fixtureId": fixture["fixture_id"], **compare_raw(cpu_raw, ort_raw)})
            ort_status = {"status": "PASS", **ort_meta}
    except Exception as error:
        default_error = repr(error)
        ort_results = []
        for fixture, cpu_raw in zip(fixtures, cpu_outputs):
            ort_raw, ort_meta = run_ort(onnx_path, fixture["pcm"], "disabled")
            ort_results.append({"fixtureId": fixture["fixture_id"], **compare_raw(cpu_raw, ort_raw)})
            ort_status = {"status": "PASS_WITH_GRAPH_OPTIMIZATION_DISABLED", "defaultLoadError": default_error, **ort_meta}

    cuda_status: dict[str, object]
    cuda_results: list[dict[str, object]] = []
    if args.try_cuda:
        try:
            import torch

            if not torch.cuda.is_available():
                cuda_status = {"status": "CUDA_PARITY_NOT_MEASURED", "reason": "torch.cuda.is_available() returned false"}
            else:
                cuda_model = load_model(checkpoint_path, "cuda")
                cuda_status = {
                    "status": "PASS",
                    "deviceCount": torch.cuda.device_count(),
                    "deviceName": torch.cuda.get_device_name(0),
                    "torchCudaVersion": torch.version.cuda,
                }
                for fixture, cpu_raw in zip(fixtures, cpu_outputs):
                    cuda_raw, latency_ms = run_torch(cuda_model, fixture["pcm"], "cuda")
                    cuda_results.append({"fixtureId": fixture["fixture_id"], "cudaForwardMs": latency_ms, **compare_raw(cpu_raw, cuda_raw)})
        except Exception as error:
            cuda_status = {"status": "CUDA_PARITY_NOT_MEASURED", "reason": repr(error)}
    else:
        cuda_status = {"status": "CUDA_PARITY_NOT_MEASURED", "reason": "--try-cuda was not supplied"}

    export_report = {
        "artifact": "phase9g_d1_robust_browser_candidate_identity_export",
        "phase": "9G-D.1",
        "checkpointIdentity": checkpoint_identity,
        "modelArchitecture": {
            "class": "piano_transcription_inference.models.Regress_onset_offset_frame_velocity_CRNN",
            "framesPerSecond": 100,
            "classesNum": 88,
        },
        "profile": {
            "candidateId": "bytedance-robust-augmented-calibrated-v1",
            "profileId": "CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05",
            "configurationSha256": "10ca01435f68b0672d01e2328762ea0773efb15b318dcd1c21105e05f9ee51ce",
            "sampleRateHz": SAMPLE_RATE,
            "modelInputMs": INPUT_MS,
            "modelInputSamples": INPUT_SAMPLES,
            "maximumFutureContextMs": 220,
            "nominalOwnedRegionMs": 600,
            "onsetThreshold": ONSET_THRESHOLD,
            "frameThreshold": FRAME_THRESHOLD,
            "noFakeZeroPadding": True,
        },
        "onnxExport": export_identity,
        "fixtureManifest": fixture_dir.relative_to(repo_root).joinpath("manifest.json").as_posix(),
        "toolVersions": {},
    }
    try:
        import torch

        export_report["toolVersions"]["torch"] = torch.__version__
    except Exception:
        pass
    try:
        import onnx

        export_report["toolVersions"]["onnx"] = onnx.__version__
    except Exception:
        pass
    try:
        import onnxruntime as ort

        export_report["toolVersions"]["onnxruntime"] = ort.__version__
    except Exception:
        pass

    parity_report = {
        "artifact": "phase9g_d1_robust_parity_chain",
        "phase": "9G-D.1",
        "referenceRuntime": "PyTorch CPU",
        "fixtureCount": len(fixtures),
        "fixtures": fixture_rows,
        "cpuPyTorch": {
            "status": "REFERENCE_EXECUTED",
            "allOutputsFinite": all(
                bool(np.isfinite(raw["reg_onset_output"]).all() and np.isfinite(raw["frame_output"]).all())
                for raw in cpu_outputs
            ),
        },
        "cudaPyTorch": {"status": cuda_status, "comparisons": cuda_results},
        "pythonOnnxRuntime": {"status": ort_status, "comparisons": ort_results},
        "decisionThresholds": {"onset": ONSET_THRESHOLD, "frame": FRAME_THRESHOLD},
        "p15p22InferenceIncrease": 0,
        "fixturePolicy": "Only non-blind p07-p14 Vienna public-proxy WAV files were eligible; complete real 1820 ms windows were required; no fake zero padding was used.",
    }
    (reports_dir / "phase9g_d1_robust_browser_candidate_identity_export_2026-10-12.json").write_text(
        json.dumps(export_report, indent=2),
        encoding="utf-8",
    )
    (reports_dir / "phase9g_d1_robust_parity_chain_2026-10-12.json").write_text(
        json.dumps(parity_report, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"export": export_report, "parity": parity_report}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
