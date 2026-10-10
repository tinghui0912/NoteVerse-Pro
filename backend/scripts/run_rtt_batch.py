"""Research-only RTT causal streaming batch transcription.

The script transcribes base scenario audio files using RTT CustomAMT (CustomAMT.ckpt),
processes audio frames with RTTPostProcessor, and outputs canonical note observations
with latency and identity receipts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import wave
from pathlib import Path

import numpy as np
import soxr
import torch

# Ensure rtt source directory is accessible
rtt_src = Path(__file__).resolve().parent.parent / "data" / "work" / "rtt_research" / "rtt" / "src"
if str(rtt_src) not in sys.path:
    sys.path.insert(0, str(rtt_src))

from models import CustomAMT  # type: ignore # noqa: E402
from postprocessing import RTTPostProcessor  # type: ignore # noqa: E402


def midi_to_pitch_name(midi_pitch: int) -> str:
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    name = names[midi_pitch % 12]
    octave = (midi_pitch // 12) - 1
    return f"{name}{octave}"


def read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        sample_rate = handle.getframerate()
        width = handle.getsampwidth()
        frames = handle.getnframes()
        raw = handle.readframes(frames)
    if width != 2:
        raise ValueError(f"Only PCM16 WAV is supported, got sample width {width}")
    pcm = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)
    return pcm, sample_rate


def deframe(x: np.ndarray, target_length: int) -> np.ndarray:
    if x.shape[0] == 1:
        return x[0][:target_length]
    x = x[:, :-1, :]
    n_seg, seg_s, _ = x.shape
    y = [x[0, : int(seg_s * 0.75)]]
    for i in range(1, n_seg - 1):
        y.append(x[i, int(seg_s * 0.25) : int(seg_s * 0.75)])
    y.append(x[-1, int(seg_s * 0.25) :])
    return np.concatenate(y, axis=0)[:target_length]


def resolve_path(p: str | Path) -> Path:
    path = Path(p)
    if path.exists():
        return path
    if not path.is_absolute():
        ws_path = Path("/workspace") / path
        if ws_path.exists():
            return ws_path
    return path


def main() -> int:
    args = parse_args()
    request = json.loads(args.input.read_text(encoding="utf-8"))
    checkpoint_path = resolve_path(args.checkpoint)
    checkpoint_sha = sha256(checkpoint_path)

    device = torch.device(args.device if (args.device == "cpu" or torch.cuda.is_available()) else "cpu")

    checkpoint = torch.load(str(checkpoint_path), map_location=device, weights_only=False)
    sd = checkpoint["state_dict"]
    clean_sd = {(k[6:] if k.startswith("model.") else k): v for k, v in sd.items()}

    model = CustomAMT()
    model.load_state_dict(clean_sd, strict=True)
    model.to(device).eval()

    segment_samples = 16000 * 3
    frames_per_sec = 100
    post_processor = RTTPostProcessor(
        frames_per_sec,
        classes_num=88,
        onset_threshold=args.onset_threshold,
        offset_threshold=args.offset_threshold,
        frame_threshold=args.frame_threshold,
    )

    results = {}
    total_started = time.perf_counter()

    for item in request["audioFiles"]:
        audio_path = resolve_path(item["audioPath"])
        started = time.perf_counter()

        audio, sample_rate = read_wav_mono(audio_path)
        if sample_rate != 16000:
            audio16k = soxr.resample(audio, sample_rate, 16000)
        else:
            audio16k = audio

        pad_len = int(np.ceil(len(audio16k) / segment_samples)) * segment_samples - len(audio16k)
        padded_audio = np.concatenate([audio16k, np.zeros(pad_len, dtype=np.float32)])

        segments = []
        pointer = 0
        while pointer + segment_samples <= len(padded_audio):
            segments.append(padded_audio[pointer : pointer + segment_samples])
            pointer += segment_samples // 2  # 50% overlap

        output_dict: dict[str, torch.Tensor] = {}
        with torch.no_grad():
            for i in range(0, len(segments), 16):
                batch_segments = torch.from_numpy(np.array(segments[i : i + 16])).to(device)
                out = model(batch_segments)
                for k in out:
                    if k in output_dict:
                        output_dict[k] = torch.cat([output_dict[k], out[k]], dim=0)
                    else:
                        output_dict[k] = out[k]

        output_np = {}
        for k in output_dict:
            output_np[k] = torch.sigmoid(output_dict[k]).cpu().numpy()

        total_frames = int(np.ceil(len(audio16k) / (16000.0 / frames_per_sec)))
        deframed_dict = {}
        for k in output_np:
            deframed_dict[k] = deframe(output_np[k], total_frames)

        raw_events = post_processor.output_dict_to_midi_events(deframed_dict)
        elapsed_ms = (time.perf_counter() - started) * 1000.0

        notes_data = []
        for ev in raw_events:
            notes_data.append(
                {
                    "midiPitch": int(ev["midi_note"]),
                    "pitch": midi_to_pitch_name(int(ev["midi_note"])),
                    "onsetTimeMs": float(ev["onset_time"] * 1000.0),
                    "offsetTimeMs": float(ev["offset_time"] * 1000.0),
                    "velocity": float(ev.get("velocity", 64)),
                }
            )

        notes_data.sort(key=lambda n: (n["onsetTimeMs"], n["midiPitch"]))

        results[item["audioKey"]] = {
            "audioPath": normalize(audio_path),
            "audioSha256": item.get("audioSha256", sha256(audio_path)),
            "inferenceLatencyMs": elapsed_ms,
            "durationMs": float(len(audio16k) / 16000.0 * 1000.0),
            "noteCount": len(notes_data),
            "notes": notes_data,
        }

    output = {
        "schemaVersion": 1,
        "artifact": "phase9g_a3_rtt_batch",
        "candidateFamily": "rtt",
        "profileId": "OFFLINE_SEGMENTWISE_NATIVE",
        "executionMode": "OFFLINE_SEGMENTWISE_REFERENCE",
        "causalStreamingSupported": False,
        "causalExecutionStatus": "EXECUTION_BLOCKED_FOR_STRICT_CAUSAL_STREAMING",
        "checkpointPath": normalize(checkpoint_path),
        "checkpointSha256": checkpoint_sha,
        "checkpointBytes": checkpoint_path.stat().st_size,
        "runtimeIdentity": {
            "image": args.runtime_identity,
            "device": str(device),
            "sampleRateHz": 16000,
            "segmentSamples": 48000,
            "overlapPercent": 50,
            "framesPerSecond": frames_per_sec,
            "classesNum": 88,
            "evalModeRequired": True,
        },
        "totalWallTimeSeconds": time.perf_counter() - total_started,
        "transcriptions": results,
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
    parser.add_argument("--onset-threshold", type=float, default=0.5)
    parser.add_argument("--offset-threshold", type=float, default=0.3)
    parser.add_argument("--frame-threshold", type=float, default=0.3)
    parser.add_argument("--runtime-identity", default="noteverse-challengers:phase9ga3")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize(path: Path) -> str:
    return str(path).replace("\\", "/")


if __name__ == "__main__":
    raise SystemExit(main())
