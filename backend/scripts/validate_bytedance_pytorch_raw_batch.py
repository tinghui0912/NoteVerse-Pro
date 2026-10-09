"""Validate Phase 9G-A.2.3 ByteDance PyTorch raw inference artifacts.

This readback validator intentionally reuses the same WAV extraction and
resampling semantics as the raw inference writer. It verifies the compact
identity carried by each raw chunk without executing the neural model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import wave
from pathlib import Path

import numpy as np


def main() -> int:
    args = parse_args()
    request = json.loads(args.input.read_text(encoding="utf-8"))
    raw = json.loads(args.raw.read_text(encoding="utf-8"))
    expected_checkpoint_sha = sha256(args.checkpoint)
    expected_checkpoint_bytes = args.checkpoint.stat().st_size

    if raw.get("schemaVersion") != 1 or raw.get("artifact") != "phase9g_a23_bytedance_pytorch_raw_batch":
        raise ValueError("Unexpected ByteDance raw artifact identity")
    if raw.get("checkpointSha256") != expected_checkpoint_sha:
        raise ValueError("Raw artifact checkpoint SHA mismatch")
    if raw.get("checkpointBytes") != expected_checkpoint_bytes:
        raise ValueError("Raw artifact checkpoint byte count mismatch")

    request_by_key = {
        (item["scenarioId"], item["contextProfileId"], item["windowId"]): item
        for item in request["windows"]
    }
    rows = []
    for chunk in raw.get("chunks", []):
        key = (chunk.get("scenarioId"), chunk.get("contextProfileId"), chunk.get("windowId"))
        item = request_by_key.get(key)
        if item is None:
            raise ValueError(f"Raw chunk references unknown request window: {key}")
        identity = chunk.get("identity")
        if identity != item.get("identity"):
            raise ValueError(f"Raw chunk identity does not equal request identity for {chunk.get('windowId')}")

        source_audio_path = Path(item["sourceAudioPath"])
        actual_source_sha = sha256(source_audio_path)
        if actual_source_sha != identity["sourceAudioSha256"]:
            raise ValueError(f"Source WAV SHA mismatch for {chunk.get('windowId')}")

        wav = read_wav_mono(source_audio_path)
        pcm16k = extract_resample_linear(
            wav["pcm"],
            wav["sampleRateHz"],
            float(item["inputStartSourceMs"]),
            float(item["inputEndSourceMs"]),
            int(item["inputSampleCount"]),
        )
        input_pcm_sha = sha256_bytes(pcm16k.astype("<f4", copy=False).tobytes())
        if chunk.get("inputPcmSha256") != input_pcm_sha:
            raise ValueError(f"Input PCM SHA mismatch for {chunk.get('windowId')}")
        if chunk.get("inputSampleRateHz") != 16000:
            raise ValueError(f"Input sample rate mismatch for {chunk.get('windowId')}")
        if chunk.get("inputSampleCount") != int(item["inputSampleCount"]):
            raise ValueError(f"Input sample count mismatch for {chunk.get('windowId')}")

        onset = validate_tensor(chunk["rawOutputs"]["reg_onset_output"], f"{chunk.get('windowId')}:reg_onset_output")
        frame = validate_tensor(chunk["rawOutputs"]["frame_output"], f"{chunk.get('windowId')}:frame_output")
        rows.append(
            {
                "scenarioId": chunk["scenarioId"],
                "contextProfileId": chunk["contextProfileId"],
                "windowId": chunk["windowId"],
                "checkpointSha256": expected_checkpoint_sha,
                "checkpointBytes": expected_checkpoint_bytes,
                "runtimeIdentity": identity["runtimeIdentity"],
                "sourceAudioSha256": actual_source_sha,
                "sourceAudioPath": identity["sourceAudioPath"],
                "inputStartSourceMs": identity["inputStartSourceMs"],
                "inputEndSourceMs": identity["inputEndSourceMs"],
                "inputSampleRateHz": chunk["inputSampleRateHz"],
                "inputSampleCount": chunk["inputSampleCount"],
                "inputPcmSha256": input_pcm_sha,
                "windowGeometrySha256": identity["windowGeometrySha256"],
                "preprocessingIdentity": identity["preprocessingIdentity"],
                "regOnsetShape": onset["shape"],
                "regOnsetFloat32ByteSha256": onset["digest"],
                "frameShape": frame["shape"],
                "frameFloat32ByteSha256": frame["digest"],
                "inferenceLatencyMs": chunk["inferenceLatencyMs"],
                "validationStatus": "PASS",
            }
        )

    output = {
        "schemaVersion": 1,
        "artifact": "phase9g_a23_bytedance_raw_readback_validation",
        "checkpointSha256": expected_checkpoint_sha,
        "checkpointBytes": expected_checkpoint_bytes,
        "rawArtifactPath": normalize(args.raw),
        "requestPath": normalize(args.input),
        "rowCount": len(rows),
        "rows": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(args.output)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def validate_tensor(tensor: dict[str, object], label: str) -> dict[str, object]:
    dims = tensor.get("dims")
    data = tensor.get("data")
    expected_digest = tensor.get("float32ByteSha256")
    if not isinstance(dims, list) or not all(isinstance(value, int) for value in dims):
        raise ValueError(f"Malformed tensor dims for {label}")
    if not isinstance(data, list) or not isinstance(expected_digest, str):
        raise ValueError(f"Malformed tensor data for {label}")
    expected_length = 1
    for dim in dims:
        expected_length *= dim
    if expected_length != len(data):
        raise ValueError(f"Tensor length mismatch for {label}")
    array = np.asarray(data, dtype=np.float32)
    if not np.all(np.isfinite(array)):
        raise ValueError(f"Tensor contains non-finite value for {label}")
    digest = sha256_bytes(array.astype("<f4", copy=False).tobytes())
    if digest != expected_digest:
        raise ValueError(f"Tensor digest mismatch for {label}")
    return {"shape": dims, "digest": digest}


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
