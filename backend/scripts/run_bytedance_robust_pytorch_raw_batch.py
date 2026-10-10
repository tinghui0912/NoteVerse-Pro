"""Research-only Robust Augmented ByteDance variable-context raw inference batch.

The script reads explicit source-window requests, extracts real WAV PCM, linearly
resamples to 16 kHz, executes Regress_onset_offset_frame_velocity_CRNN without pedal head,
and writes raw reg_onset/frame tensors with identity hashes. It does not score scenarios.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import wave
from pathlib import Path

import numpy as np
import torch
from piano_transcription_inference.models import Regress_onset_offset_frame_velocity_CRNN


def main() -> int:
    args = parse_args()
    request = json.loads(args.input.read_text(encoding="utf-8"))
    checkpoint_sha = sha256(args.checkpoint)

    device = torch.device(args.device if (args.device == "cpu" or torch.cuda.is_available()) else "cpu")
    checkpoint = torch.load(args.checkpoint, map_location=device, weights_only=False)
    model = Regress_onset_offset_frame_velocity_CRNN(frames_per_second=100, classes_num=88)
    model.load_state_dict(checkpoint["model"], strict=True)
    model.to(device).eval()

    # Warm up
    warmup_x = torch.zeros(1, 29120, device=device)
    with torch.no_grad():
        _ = model(warmup_x)

    chunks = []
    # Cache audio files to avoid redundant WAV re-reads
    audio_cache: dict[str, dict[str, object]] = {}

    for item in request["windows"]:
        audio_path_str = item["sourceAudioPath"]
        if audio_path_str not in audio_cache:
            audio_cache[audio_path_str] = read_wav_mono(resolve_path(audio_path_str))
        wav = audio_cache[audio_path_str]

        pcm16k = extract_resample_linear(
            wav["pcm"],
            wav["sampleRateHz"],
            float(item["inputStartSourceMs"]),
            float(item["inputEndSourceMs"]),
            int(item["inputSampleCount"]),
        )
        started = time.perf_counter()
        with torch.no_grad():
            tensor_in = torch.from_numpy(pcm16k[None, :]).to(device)
            out = model(tensor_in)
            onset = out["reg_onset_output"].squeeze(0).cpu().numpy().astype(np.float32, copy=False)
            frame = out["frame_output"].squeeze(0).cpu().numpy().astype(np.float32, copy=False)
        elapsed = (time.perf_counter() - started) * 1000.0

        chunks.append(
            {
                "windowId": item["windowId"],
                "scenarioId": item["scenarioId"],
                "contextProfileId": item["contextProfileId"],
                "inputPcmSha256": sha256_bytes(pcm16k.astype("<f4", copy=False).tobytes()),
                "inputSampleRateHz": 16000,
                "inputSampleCount": int(pcm16k.shape[0]),
                "inferenceLatencyMs": float(elapsed),
                "rawOutputs": {
                    "reg_onset_output": {
                        "dims": list(onset.shape),
                        "data": onset.reshape(-1).astype(float).tolist(),
                        "float32ByteSha256": sha256_bytes(onset.astype("<f4", copy=False).tobytes()),
                    },
                    "frame_output": {
                        "dims": list(frame.shape),
                        "data": frame.reshape(-1).astype(float).tolist(),
                        "float32ByteSha256": sha256_bytes(frame.astype("<f4", copy=False).tobytes()),
                    },
                },
                "identity": item["identity"],
            }
        )

    output = {
        "schemaVersion": 1,
        "artifact": "phase9g_a3_bytedance_robust_pytorch_raw_batch",
        "checkpointPath": normalize(args.checkpoint),
        "checkpointSha256": checkpoint_sha,
        "checkpointBytes": args.checkpoint.stat().st_size,
        "runtimeIdentity": {
            "image": args.runtime_identity,
            "device": str(device),
        },
        "chunks": chunks,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(args.output)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--runtime-identity", default="noteverse-challengers:phase9ga3")
    return parser.parse_args()


def resolve_path(p: str | Path) -> Path:
    path = Path(p)
    if path.exists():
        return path
    if not path.is_absolute():
        ws_path = Path("/workspace") / path
        if ws_path.exists():
            return ws_path
    return path


def read_wav_mono(path: Path) -> dict[str, object]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        sample_rate = handle.getframerate()
        width = handle.getsampwidth()
        frames = handle.getnframes()
        raw = handle.readframes(frames)
    if width != 2:
        raise ValueError(f"Only PCM16 WAV is supported for research input, got sample width {width}")
    pcm = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)
    return {"pcm": pcm.astype(np.float32, copy=False), "sampleRateHz": sample_rate}


def extract_resample_linear(
    source: np.ndarray,
    source_rate: int,
    start_ms: float,
    end_ms: float,
    output_samples: int,
) -> np.ndarray:
    start = start_ms / 1000.0 * source_rate
    end = end_ms / 1000.0 * source_rate
    if start < -1e-6 or end > source.shape[0] + 1e-6 or end <= start:
        raise ValueError(f"Requested source window outside WAV: {start_ms}..{end_ms} ms")
    positions = np.linspace(start, end, output_samples, endpoint=False)
    left = np.floor(positions).astype(np.int64)
    right = np.minimum(source.shape[0] - 1, left + 1)
    frac = positions - left
    return (source[left] * (1.0 - frac) + source[right] * frac).astype(np.float32)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def normalize(path: Path) -> str:
    return str(path).replace("\\", "/")


if __name__ == "__main__":
    raise SystemExit(main())
