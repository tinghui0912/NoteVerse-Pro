"""Diagnose a single recorded practice audio file against the live engine."""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess

import numpy as np

from app.processing.engines.practice_alignment.matchmaker_live import MatchmakerLiveEngine
from app.processing.engines.practice_alignment.profile import DEFAULT_PRACTICE_AUDIO_PROFILE


RELIABLE_ALIGNMENT_CONFIDENCE = 0.75


def decode_audio(path: Path, sample_rate: int) -> np.ndarray:
    raw = subprocess.check_output(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-f",
            "s16le",
            "-",
        ]
    )
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def pcm_s16le(frame: np.ndarray) -> bytes:
    return (np.clip(frame, -1.0, 1.0) * 32767).astype("<i2").tobytes()


def number_value(value: object, default: float = 0.0) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return default


def round_optional(value: float | None, digits: int = 3) -> float | None:
    return None if value is None else round(value, digits)


def diagnose_recording(
    *,
    score_path: Path,
    recording_path: Path,
    sample_rate: int,
    chunk_size_samples: int,
    progression_mode: str,
    realtime_guidance: str,
    evaluation_profile: str,
) -> dict[str, object]:
    audio = decode_audio(recording_path, sample_rate)
    engine = MatchmakerLiveEngine(
        score_file_path=str(score_path),
        sample_rate=sample_rate,
        channels=1,
        frame_format="pcm_s16le",
        progression_mode=progression_mode,
        realtime_guidance=realtime_guidance,
        evaluation_profile=evaluation_profile,
        input_source="MICROPHONE",
    )
    try:
        silence = np.zeros(engine.hop_length, dtype=np.float32)
        for _ in range(DEFAULT_PRACTICE_AUDIO_PROFILE.warmup_frames):
            engine.ingest_audio(pcm_s16le(silence))

        frame_count = 0
        updates: list[dict[str, object]] = []
        gate_reasons: Counter[str] = Counter()
        stream_states: Counter[str] = Counter()
        frame_classes: Counter[str] = Counter()
        first_musical_activity_seconds: float | None = None
        start_confirmed_seconds: float | None = None
        first_update_seconds: float | None = None
        first_reliable_alignment_seconds: float | None = None
        start_feature_mismatch_frames = 0
        max_start_feature_confidence: float | None = None
        reliable_update_count = 0
        previous_stream_state: str | None = None
        first_following_seconds: float | None = None
        first_lost_seconds: float | None = None
        lost_episode_count = 0
        post_start_frame_count = 0
        following_frame_count = 0
        holding_decay_frame_count = 0
        lost_frame_count = 0
        min_alignment_beat: float | None = None
        max_alignment_beat: float | None = None
        last_alignment_beat: float | None = None

        for start in range(0, audio.size, chunk_size_samples):
            chunk = audio[start : start + chunk_size_samples]
            if chunk.size == 0:
                continue
            seconds = round(start / sample_rate, 3)
            update = engine.ingest_audio(pcm_s16le(chunk))
            stream = engine._stream
            frame_count += 1
            gate_reasons[str(stream.last_gate_reason)] += 1
            stream_states[str(stream.stream_state)] += 1
            frame_classes[str(stream.last_frame_class)] += 1
            stream_state = str(stream.stream_state)
            if stream.started:
                post_start_frame_count += 1
                if stream_state == "following":
                    following_frame_count += 1
                    if first_following_seconds is None:
                        first_following_seconds = seconds
                elif stream_state == "holding_decay":
                    holding_decay_frame_count += 1
                elif stream_state == "lost":
                    lost_frame_count += 1
                    if first_lost_seconds is None:
                        first_lost_seconds = seconds
                    if previous_stream_state != "lost":
                        lost_episode_count += 1
            previous_stream_state = stream_state
            if stream.last_gate_reason == "start_feature_mismatch":
                start_feature_mismatch_frames += 1
            if stream.last_start_feature_confidence is not None:
                max_start_feature_confidence = (
                    stream.last_start_feature_confidence
                    if max_start_feature_confidence is None
                    else max(max_start_feature_confidence, stream.last_start_feature_confidence)
                )
            if (
                first_musical_activity_seconds is None
                and (
                    stream.last_onset_signal
                    or stream.last_tonal_signal
                    or stream.last_rms >= stream.rms_gate * 0.75
                    or stream.last_peak >= stream.peak_gate * 0.75
                )
            ):
                first_musical_activity_seconds = seconds
            if stream.started and start_confirmed_seconds is None:
                start_confirmed_seconds = seconds
            if update is not None:
                if first_update_seconds is None:
                    first_update_seconds = seconds
                updates.append(update)
                confidence = float(update.get("confidence", 0.0))
                beat_position = number_value(update.get("beat_position"))
                min_alignment_beat = (
                    beat_position if min_alignment_beat is None else min(min_alignment_beat, beat_position)
                )
                max_alignment_beat = (
                    beat_position if max_alignment_beat is None else max(max_alignment_beat, beat_position)
                )
                last_alignment_beat = beat_position
                if confidence >= RELIABLE_ALIGNMENT_CONFIDENCE:
                    reliable_update_count += 1
                if first_reliable_alignment_seconds is None and confidence >= RELIABLE_ALIGNMENT_CONFIDENCE:
                    first_reliable_alignment_seconds = seconds

        first_update = updates[0] if updates else None
        first_reliable_update = next(
            (update for update in updates if number_value(update.get("confidence")) >= 0.75),
            None,
        )
        return {
            "recording": str(recording_path),
            "score": str(score_path),
            "progression_mode": progression_mode,
            "sample_rate": sample_rate,
            "chunk_size_samples": chunk_size_samples,
            "duration_seconds": round(audio.size / sample_rate, 3),
            "warmup_frames": DEFAULT_PRACTICE_AUDIO_PROFILE.warmup_frames,
            "hop_length": engine.hop_length,
            "input_rms": round(float(np.sqrt(np.mean(np.square(audio)))), 5) if audio.size else 0.0,
            "input_peak": round(float(np.max(np.abs(audio))), 5) if audio.size else 0.0,
            "armed": engine._stream.armed,
            "armed_at_seconds": 0.0,
            "first_musical_activity_seconds": first_musical_activity_seconds,
            "start_confirmed": engine._stream.started,
            "start_confirmed_seconds": start_confirmed_seconds,
            "first_update_seconds": first_update_seconds,
            "first_reliable_alignment_seconds": first_reliable_alignment_seconds,
            "first_alignment_beat": None if first_update is None else first_update.get("beat_position"),
            "first_reliable_alignment_beat": (
                None if first_reliable_update is None else first_reliable_update.get("beat_position")
            ),
            "emitted_updates": len(updates),
            "final_stream_state": engine._stream.stream_state,
            "final_gate_reason": engine._stream.last_gate_reason,
            "start_feature_mismatch_frames": start_feature_mismatch_frames,
            "max_start_feature_confidence": max_start_feature_confidence,
            "gate_reason_counts": dict(gate_reasons.most_common()),
            "stream_state_counts": dict(stream_states.most_common()),
            "frame_class_counts": dict(frame_classes.most_common()),
            "follow_quality": {
                "reliable_confidence_threshold": RELIABLE_ALIGNMENT_CONFIDENCE,
                "reliable_update_count": reliable_update_count,
                "reliable_update_ratio": round(reliable_update_count / len(updates), 4) if updates else 0.0,
                "time_to_first_reliable_alignment_seconds": round_optional(
                    None
                    if first_reliable_alignment_seconds is None or start_confirmed_seconds is None
                    else first_reliable_alignment_seconds - start_confirmed_seconds
                ),
                "first_following_seconds": first_following_seconds,
                "first_lost_seconds": first_lost_seconds,
                "lost_episode_count": lost_episode_count,
                "post_start_frames": post_start_frame_count,
                "following_frame_ratio": round(following_frame_count / post_start_frame_count, 4)
                if post_start_frame_count
                else 0.0,
                "holding_decay_frame_ratio": round(holding_decay_frame_count / post_start_frame_count, 4)
                if post_start_frame_count
                else 0.0,
                "lost_frame_ratio": round(lost_frame_count / post_start_frame_count, 4)
                if post_start_frame_count
                else 0.0,
                "min_alignment_beat": round_optional(min_alignment_beat),
                "max_alignment_beat": round_optional(max_alignment_beat),
                "last_alignment_beat": round_optional(last_alignment_beat),
                "alignment_advance_beats": round_optional(
                    None
                    if min_alignment_beat is None or max_alignment_beat is None
                    else max_alignment_beat - min_alignment_beat
                ),
            },
            "not_tonal_frame_ratio": round(
                gate_reasons["not_tonal"] / frame_count,
                4,
            )
            if frame_count
            else 0.0,
        }
    finally:
        engine.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--score", type=Path, required=True)
    parser.add_argument("--recording", type=Path, required=True)
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--chunk-size-samples", type=int, default=640)
    parser.add_argument(
        "--progression-mode",
        choices=("CONTINUOUS", "WAIT_FOR_NOTE"),
        default="CONTINUOUS",
    )
    parser.add_argument("--realtime-guidance", default="STATUS_ONLY")
    parser.add_argument("--evaluation-profile", default="PERFORMANCE")
    args = parser.parse_args()
    if not args.score.is_file():
        parser.error(f"--score does not exist or is not a file: {args.score}")
    if not args.recording.is_file():
        parser.error(f"--recording does not exist or is not a file: {args.recording}")
    return args


def main() -> int:
    args = parse_args()
    report = diagnose_recording(
        score_path=args.score,
        recording_path=args.recording,
        sample_rate=args.sample_rate,
        chunk_size_samples=args.chunk_size_samples,
        progression_mode=args.progression_mode,
        realtime_guidance=args.realtime_guidance,
        evaluation_profile=args.evaluation_profile,
    )
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
