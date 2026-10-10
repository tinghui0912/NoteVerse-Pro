"""Research-only Aria-AMT batch transcription.

The script transcribes base scenario audio files using Aria-AMT (piano-medium-double-1.0.safetensors),
extracts note events from the transcribed MIDI, and outputs canonical note observations
with latency and identity receipts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time
from pathlib import Path

import mido
from amt.run import transcribe


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
    checkpoint_path = resolve_path(args.checkpoint)
    checkpoint_sha = sha256(checkpoint_path)

    work_dir = args.work_dir
    work_dir.mkdir(parents=True, exist_ok=True)
    temp_audio_dir = work_dir / "temp_audio"
    temp_midi_dir = work_dir / "temp_midi"
    temp_audio_dir.mkdir(parents=True, exist_ok=True)
    temp_midi_dir.mkdir(parents=True, exist_ok=True)

    # Copy / symlink or prepare files with clean filenames in temp_audio_dir
    key_to_stem = {}
    for item in request["audioFiles"]:
        src_path = resolve_path(item["audioPath"])
        stem = f"{item['audioKey']}_{src_path.stem}"
        clean_audio = temp_audio_dir / f"{stem}{src_path.suffix}"
        if not clean_audio.exists():
            shutil.copy2(src_path, clean_audio)
        key_to_stem[item["audioKey"]] = stem

    total_started = time.perf_counter()

    # Run Aria-AMT batch transcribe
    transcribe(
        model_name=args.model_name,
        checkpoint_path=str(checkpoint_path),
        save_dir=str(temp_midi_dir),
        load_dir=str(temp_audio_dir),
        batch_size=args.batch_size,
        num_workers=args.num_workers,
        compile_mode=False,
    )

    total_elapsed = time.perf_counter() - total_started

    results = {}
    for item in request["audioFiles"]:
        key = item["audioKey"]
        stem = key_to_stem[key]
        midi_path = temp_midi_dir / f"{stem}.mid"
        if not midi_path.exists():
            # Search case-insensitive or without extension
            matches = list(temp_midi_dir.glob(f"*{stem}*"))
            if matches:
                midi_path = matches[0]
            else:
                raise FileNotFoundError(f"Expected transcribed MIDI not found for {key}: {midi_path}")

        mid = mido.MidiFile(str(midi_path))
        notes_data = []
        active_notes: dict[int, tuple[float, float]] = {}
        current_time_sec = 0.0

        for msg in mid:
            current_time_sec += msg.time
            if msg.type == "note_on" and msg.velocity > 0:
                active_notes[msg.note] = (current_time_sec, float(msg.velocity))
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                if msg.note in active_notes:
                    start_sec, vel = active_notes.pop(msg.note)
                    notes_data.append(
                        {
                            "midiPitch": int(msg.note),
                            "pitch": midi_to_pitch_name(int(msg.note)),
                            "onsetTimeMs": float(start_sec * 1000.0),
                            "offsetTimeMs": float(current_time_sec * 1000.0),
                            "velocity": vel,
                        }
                    )

        for pitch, (start_sec, vel) in active_notes.items():
            notes_data.append(
                {
                    "midiPitch": int(pitch),
                    "pitch": midi_to_pitch_name(int(pitch)),
                    "onsetTimeMs": float(start_sec * 1000.0),
                    "offsetTimeMs": float(current_time_sec * 1000.0),
                    "velocity": vel,
                }
            )

        notes_data.sort(key=lambda n: (n["onsetTimeMs"], n["midiPitch"]))
        duration_ms = float(current_time_sec * 1000.0)

        results[key] = {
            "audioPath": normalize(Path(item["audioPath"])),
            "audioSha256": item.get("audioSha256", sha256(Path(item["audioPath"]))),
            "midiPath": normalize(midi_path),
            "inferenceLatencyMs": None,
            "perFileLatencyStatus": "NOT_MEASURED",
            "durationMs": duration_ms,
            "noteCount": len(notes_data),
            "notes": notes_data,
        }

    output = {
        "schemaVersion": 1,
        "artifact": "phase9g_a3_aria_amt_batch",
        "candidateFamily": "aria-amt",
        "profileId": "UPSTREAM_NATIVE_PIANO_MEDIUM_DOUBLE",
        "checkpointPath": normalize(checkpoint_path),
        "checkpointSha256": checkpoint_sha,
        "checkpointBytes": checkpoint_path.stat().st_size,
        "runtimeIdentity": {
            "image": args.runtime_identity,
            "modelName": args.model_name,
            "device": args.device,
            "sampleRateHz": 16000,
        },
        "totalWallTimeSeconds": total_elapsed,
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
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--model-name", default="medium-double")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--num-workers", type=int, default=1)
    parser.add_argument("--runtime-identity", default="noteverse-aria-amt-bench:gpu-cu124-patched")
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
