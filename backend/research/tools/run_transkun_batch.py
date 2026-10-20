"""Research-only Transkun V2 Aug offline batch transcription.

The script transcribes base scenario audio files using TransKun v2.0 (checkpointMSimplerAug),
extracts note events (onset, pitch, velocity), and records raw transcription outputs
with execution latency and identity receipts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import moduleconf
import numpy as np
import pretty_midi
import soxr
import torch
from transkun.transcribe import readAudio


def midi_to_pitch_name(midi_pitch: int) -> str:
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    name = names[midi_pitch % 12]
    octave = (midi_pitch // 12) - 1
    return f"{name}{octave}"


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
    weight_path = resolve_path(args.weight)
    conf_path = resolve_path(args.conf)
    weight_sha = sha256(weight_path)
    conf_sha = sha256(conf_path)

    device = torch.device(args.device if (args.device == "cpu" or torch.cuda.is_available()) else "cpu")

    conf_manager = moduleconf.parseFromFile(str(conf_path))
    TransKun = conf_manager["Model"].module.TransKun
    conf = conf_manager["Model"].config

    checkpoint = torch.load(str(weight_path), map_location=device, weights_only=False)
    model = TransKun(conf=conf).to(device)

    sd = checkpoint.get("best_state_dict", checkpoint.get("state_dict"))
    if sd is None:
        raise ValueError(f"No valid state_dict found in Transkun checkpoint: {weight_path}")
    incompatible = model.load_state_dict(sd, strict=True)
    if incompatible.missing_keys or incompatible.unexpected_keys:
        raise RuntimeError(
            f"Transkun state dict mismatch: missing={incompatible.missing_keys}, unexpected={incompatible.unexpected_keys}"
        )
    model.eval()

    results = {}
    total_started = time.perf_counter()

    for item in request["audioFiles"]:
        audio_path = resolve_path(item["audioPath"])
        started = time.perf_counter()

        fs, audio = readAudio(str(audio_path))
        if fs != model.fs:
            audio = soxr.resample(audio, fs, model.fs)

        x = torch.from_numpy(audio).to(device)
        with torch.no_grad():
            notes_est = model.transcribe(
                x,
                stepInSecond=args.segment_hop_size,
                segmentSizeInSecond=args.segment_size,
                discardSecondHalf=False,
            )
        elapsed_ms = (time.perf_counter() - started) * 1000.0

        notes_data = []
        for note in notes_est:
            if note.pitch > 0:
                notes_data.append(
                    {
                        "midiPitch": int(note.pitch),
                        "pitch": midi_to_pitch_name(int(note.pitch)),
                        "onsetTimeMs": float(note.start * 1000.0),
                        "offsetTimeMs": float(note.end * 1000.0),
                        "velocity": float(note.velocity),
                    }
                )

        # Sort by onset time
        notes_data.sort(key=lambda n: (n["onsetTimeMs"], n["midiPitch"]))

        results[item["audioKey"]] = {
            "audioPath": normalize(audio_path),
            "audioSha256": item.get("audioSha256", sha256(audio_path)),
            "inferenceLatencyMs": elapsed_ms,
            "durationMs": float(len(audio) / model.fs * 1000.0),
            "noteCount": len(notes_data),
            "notes": notes_data,
        }

    output = {
        "schemaVersion": 1,
        "artifact": "phase9g_a3_transkun_v2_aug_batch",
        "candidateFamily": "transkun",
        "profileId": "UPSTREAM_NATIVE_V2_AUG",
        "weightPath": normalize(weight_path),
        "weightSha256": weight_sha,
        "weightBytes": weight_path.stat().st_size,
        "confPath": normalize(conf_path),
        "confSha256": conf_sha,
        "runtimeIdentity": {
            "image": args.runtime_identity,
            "device": str(device),
            "sampleRateHz": model.fs,
            "segmentSizeSeconds": args.segment_size,
            "segmentHopSeconds": args.segment_hop_size,
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
    parser.add_argument("--weight", type=Path, required=True)
    parser.add_argument("--conf", type=Path, required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--segment-size", type=float, default=16.0)
    parser.add_argument("--segment-hop-size", type=float, default=8.0)
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
