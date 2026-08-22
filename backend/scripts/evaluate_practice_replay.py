"""Replay real practice audio against Matchmaker and emit a JSON report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import time
import wave

import numpy as np

from app.processing.engines.practice_alignment.matchmaker_live import MatchmakerLiveEngine
from app.processing.engines.practice_alignment.profile import DEFAULT_PRACTICE_AUDIO_PROFILE


def read_pcm_wav(path: Path, sample_rate: int) -> np.ndarray:
    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        width = wav_file.getsampwidth()
        source_rate = wav_file.getframerate()
        frames = wav_file.readframes(wav_file.getnframes())

    if width != 2 or source_rate != sample_rate:
        raise ValueError(f"Expected 16-bit {sample_rate} Hz PCM WAV: {path}")

    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio


def mix_sources(root: Path, spec: dict, sample_rate: int) -> np.ndarray:
    duration_samples = int(float(spec["duration_seconds"]) * sample_rate)
    mix = np.zeros(duration_samples, dtype=np.float32)

    for source in spec["sources"]:
        audio = read_pcm_wav(root / source["path"], sample_rate)
        offset = int(float(source.get("offset_seconds", 0.0)) * sample_rate)
        if offset >= duration_samples:
            continue
        available_samples = duration_samples - offset
        if bool(source.get("loop", False)) and audio.size:
            audio = np.tile(audio, int(np.ceil(available_samples / audio.size)))
        gain = 10 ** (float(source.get("gain_db", 0.0)) / 20.0)
        length = min(audio.size, available_samples)
        mix[offset : offset + length] += audio[:length] * gain

    peak = float(np.max(np.abs(mix))) if mix.size else 0.0
    return mix * (0.98 / peak) if peak > 0.98 else mix


def scenario_audio(root: Path, scenario: dict, sample_rate: int) -> np.ndarray:
    chunks: list[np.ndarray] = []
    for frame_spec in scenario["frames"]:
        frame_type = frame_spec["type"]
        repeat_count = int(frame_spec.get("repeat", 1))
        if repeat_count <= 0:
            raise ValueError("frame repeat must be positive")
        if frame_type == "wav":
            frame_audio = read_pcm_wav(root / frame_spec["path"], sample_rate)
        elif frame_type == "mix_wav":
            frame_audio = mix_sources(root, frame_spec, sample_rate)
        else:
            raise ValueError(f"Unsupported replay source: {frame_type}")
        chunks.extend(frame_audio for _ in range(repeat_count))
    audio = np.concatenate(chunks) if chunks else np.array([], dtype=np.float32)

    armed_delay_samples = int(float(scenario.get("armed_delay_seconds", 0.0)) * sample_rate)
    leading_sample_offset = int(scenario.get("leading_sample_offset", 0))
    if armed_delay_samples < 0:
        raise ValueError("armed_delay_seconds must be non-negative")
    if leading_sample_offset < 0:
        raise ValueError("leading_sample_offset must be non-negative")

    prefix_samples = armed_delay_samples + leading_sample_offset
    if prefix_samples:
        audio = np.concatenate((np.zeros(prefix_samples, dtype=np.float32), audio))
    return audio


def pcm_s16le(frame: np.ndarray) -> bytes:
    clipped = np.clip(frame, -1.0, 1.0)
    return (clipped * 32767).astype("<i2").tobytes()


def run_scenario(
    *,
    score_path: Path,
    fixture_root: Path,
    scenario: dict,
    sample_rate: int,
) -> dict:
    engine = MatchmakerLiveEngine(
        score_file_path=str(score_path),
        sample_rate=sample_rate,
        channels=1,
        frame_format="pcm_s16le",
    )
    try:
        hop_length = engine.hop_length
        silence = np.zeros(hop_length, dtype=np.float32)
        for _ in range(DEFAULT_PRACTICE_AUDIO_PROFILE.warmup_frames):
            engine.ingest_audio(pcm_s16le(silence))

        audio = scenario_audio(fixture_root, scenario, sample_rate)
        chunk_size_samples = int(scenario.get("chunk_size_samples", hop_length))
        if chunk_size_samples <= 0:
            raise ValueError("chunk_size_samples must be positive")
        emitted_updates: list[dict] = []
        source_states: list[str] = []
        started_frame: int | None = None
        started_sample: int | None = None
        start_feature_confidence: float | None = None
        start_feature_mismatch_frames = 0
        max_start_feature_confidence: float | None = None
        pause_after_seconds = scenario.get("pause_after_seconds")
        pause_checked = False
        pause_emitted_updates = 0
        emitted_updates_before_pause: int | None = None

        for frame_index, start in enumerate(
            range(0, len(audio) - chunk_size_samples + 1, chunk_size_samples),
            1,
        ):
            elapsed_seconds = start / sample_rate
            if (
                pause_after_seconds is not None
                and not pause_checked
                and elapsed_seconds >= float(pause_after_seconds)
            ):
                before_pause = len(emitted_updates)
                time.sleep(0.2)
                pause_emitted_updates = len(emitted_updates) - before_pause
                emitted_updates_before_pause = before_pause
                pause_checked = True

            update = engine.ingest_audio(pcm_s16le(audio[start : start + chunk_size_samples]))
            if update is not None:
                emitted_updates.append(update)
            source_states.append(engine._stream.stream_state)
            start_confidence = engine._stream.last_start_feature_confidence
            if start_confidence is not None:
                max_start_feature_confidence = (
                    start_confidence
                    if max_start_feature_confidence is None
                    else max(max_start_feature_confidence, start_confidence)
                )
            if engine._stream.last_gate_reason == "start_feature_mismatch":
                start_feature_mismatch_frames += 1
            if engine._stream.started and started_frame is None:
                started_frame = frame_index
                started_sample = start
                start_feature_confidence = engine._stream.last_start_feature_confidence

        start_seconds = (
            None
            if started_sample is None
            else round(started_sample / sample_rate, 3)
        )
        first_update = emitted_updates[0] if emitted_updates else None
        emitted_beats = [update["beat_position"] for update in emitted_updates]
        first_alignment_beat = None if first_update is None else first_update["beat_position"]
        max_alignment_beat = max(emitted_beats, default=None)
        return {
            "id": scenario["id"],
            "started": engine._stream.started,
            "start_seconds": start_seconds,
            "chunk_size_samples": chunk_size_samples,
            "leading_sample_offset": int(scenario.get("leading_sample_offset", 0)),
            "armed_delay_seconds": float(scenario.get("armed_delay_seconds", 0.0)),
            "start_feature_confidence": start_feature_confidence,
            "max_start_feature_confidence": max_start_feature_confidence,
            "start_feature_mismatch_frames": start_feature_mismatch_frames,
            "first_alignment_beat": first_alignment_beat,
            "max_alignment_beat": max_alignment_beat,
            "alignment_advance": (
                None
                if first_alignment_beat is None or max_alignment_beat is None
                else round(max_alignment_beat - first_alignment_beat, 3)
            ),
            "first_gate_reason": (
                None if first_update is None else first_update.get("gate_reason")
            ),
            "emitted_updates": len(emitted_updates),
            "lost_frames": sum(state == "lost" for state in source_states),
            "pause_checked": pause_checked,
            "pause_emitted_updates": pause_emitted_updates,
            "resume_emitted_updates": (
                0
                if emitted_updates_before_pause is None
                else len(emitted_updates) - emitted_updates_before_pause
            ),
        }
    finally:
        engine.close()


def evaluate_result(result: dict, expect: dict) -> list[str]:
    failures: list[str] = []
    if result.get("error"):
        return [f"error={result['error']}"]
    if result["started"] is not expect["starts"]:
        failures.append(f"started={result['started']} expected={expect['starts']}")
    if result["started"]:
        start_seconds = result["start_seconds"]
        if start_seconds is None:
            failures.append("missing start time")
        elif start_seconds < expect.get("start_seconds_min", 0):
            failures.append(f"start_seconds={start_seconds} below minimum")
        elif start_seconds > expect.get("start_seconds_max", float("inf")):
            failures.append(f"start_seconds={start_seconds} above maximum")
        if result["lost_frames"] > expect.get("max_lost_frames", float("inf")):
            failures.append(f"lost_frames={result['lost_frames']} above maximum")
        if (
            "first_alignment_beat" in expect
            and result["first_alignment_beat"] != expect["first_alignment_beat"]
        ):
            failures.append(
                "first_alignment_beat="
                f"{result['first_alignment_beat']} expected={expect['first_alignment_beat']}"
            )
        if "first_alignment_beat_min" in expect:
            first_alignment_beat = result["first_alignment_beat"]
            if first_alignment_beat is None:
                failures.append("missing first_alignment_beat")
            elif first_alignment_beat < expect["first_alignment_beat_min"]:
                failures.append(f"first_alignment_beat={first_alignment_beat} below minimum")
        if "first_alignment_beat_max" in expect:
            first_alignment_beat = result["first_alignment_beat"]
            if first_alignment_beat is None:
                failures.append("missing first_alignment_beat")
            elif first_alignment_beat > expect["first_alignment_beat_max"]:
                failures.append(f"first_alignment_beat={first_alignment_beat} above maximum")
        if result["alignment_advance"] is not None and result["alignment_advance"] < expect.get(
            "min_alignment_advance", 0
        ):
            failures.append(f"alignment_advance={result['alignment_advance']} below minimum")
    if result["pause_checked"] and result["pause_emitted_updates"]:
        failures.append("emitted an update while paused")
    if result["pause_checked"] and not result["resume_emitted_updates"]:
        failures.append("did not resume emitting updates")
    return failures


def parse_args() -> argparse.Namespace:
    fixture_root = Path(__file__).parents[1] / "tests" / "fixtures" / "practice_audio"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--score", type=Path, required=True)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=fixture_root / "profile_manifest.json",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    fixture_root = args.manifest.parent
    sample_rate = int(manifest["sample_rate"])
    results = []

    for scenario in manifest["scenarios"]:
        try:
            result = run_scenario(
                score_path=args.score,
                fixture_root=fixture_root,
                scenario=scenario,
                sample_rate=sample_rate,
            )
        except Exception as exc:  # pragma: no cover - exercised by real-engine fixtures.
            result = {
                "id": scenario["id"],
                "started": False,
                "error": f"{type(exc).__name__}: {exc}",
                "chunk_size_samples": scenario.get("chunk_size_samples"),
                "leading_sample_offset": int(scenario.get("leading_sample_offset", 0)),
                "armed_delay_seconds": float(scenario.get("armed_delay_seconds", 0.0)),
            }
        result["failures"] = evaluate_result(result, scenario["expect"])
        results.append(result)

    report = {
        "profile": DEFAULT_PRACTICE_AUDIO_PROFILE.__dict__,
        "passed": all(not result["failures"] for result in results),
        "results": results,
    }
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
