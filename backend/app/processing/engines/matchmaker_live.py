from __future__ import annotations

import os
import queue
import tempfile
import threading
import time
import wave
from pathlib import Path
from typing import Protocol, TypedDict, runtime_checkable

from app.processing.engines.score_timeline import ScoreTimelineEvent, ScoreTimelineResult


class AlignmentUpdate(TypedDict):
    event_index: int
    measure_index: int
    measure_number: int
    beat_position: float
    confidence: float
    timestamp_ms: int
    score_completed: bool


@runtime_checkable
class AlignmentEngine(Protocol):
    """Realtime alignment engine that consumes browser-provided audio chunks."""

    def ingest_audio(self, chunk: bytes) -> AlignmentUpdate | None:
        ...

    def close(self) -> None:
        ...


class MatchmakerLiveEngine:
    """Matchmaker-backed live engine for browser WebSocket PCM streams."""

    def __init__(
        self,
        timeline: ScoreTimelineResult,
        score_file_path: str,
        sample_rate: int,
        channels: int,
        frame_format: str,
    ) -> None:
        if channels != 1:
            raise RuntimeError("Matchmaker practice sessions require mono audio.")
        if frame_format != "pcm_s16le":
            raise RuntimeError("Matchmaker practice sessions require pcm_s16le audio.")

        try:
            import numpy as np
            from matchmaker import Matchmaker
        except ImportError as exc:
            raise RuntimeError(
                "pymatchmaker is not installed. Install the Matchmaker runtime "
                "dependencies before starting live practice sessions."
            ) from exc

        self.timeline = timeline
        self.sample_rate = sample_rate
        self.channels = channels
        self.frame_format = frame_format
        self.total_bytes = 0
        self.current_event_index = -1
        self._np = np
        self._error: Exception | None = None
        self._closed = threading.Event()
        self._updates: queue.Queue[AlignmentUpdate] = queue.Queue()
        self._silent_audio_path = self._create_silent_audio_file(sample_rate)

        try:
            self._matcher = Matchmaker(
                score_file=str(Path(score_file_path)),
                performance_file=self._silent_audio_path,
                wait=False,
                input_type="audio",
                sample_rate=sample_rate,
            )
        except Exception:
            self.close()
            raise
        self._worker = threading.Thread(
            target=self._run_follower,
            name=f"matchmaker-live-{Path(score_file_path).stem}",
            daemon=True,
        )
        self._worker.start()

    def ingest_audio(self, chunk: bytes) -> AlignmentUpdate | None:
        if self._error is not None:
            raise RuntimeError(str(self._error)) from self._error
        if not chunk or not self.timeline["events"]:
            return None

        self.total_bytes += len(chunk)
        audio_frame = self._pcm_s16le_to_float32(chunk)
        self._matcher.stream._process_feature(audio_frame, time.perf_counter())

        latest: AlignmentUpdate | None = None
        while True:
            try:
                latest = self._updates.get_nowait()
            except queue.Empty:
                break
        return latest

    def close(self) -> None:
        self._closed.set()
        try:
            os.remove(self._silent_audio_path)
        except OSError:
            pass

    def _run_follower(self) -> None:
        try:
            for current_frame in self._matcher.score_follower.run(verbose=False):
                if self._closed.is_set():
                    break

                beat_position = self._frame_to_beat(current_frame)
                alignment = self._alignment_from_beat(beat_position)
                if alignment is None:
                    continue

                self._updates.put(alignment)
                if alignment["score_completed"]:
                    break
        except Exception as exc:  # pragma: no cover - depends on runtime package internals.
            self._error = exc

    def _pcm_s16le_to_float32(self, chunk: bytes):
        samples = self._np.frombuffer(chunk, dtype=self._np.int16)
        return (samples.astype(self._np.float32) / 32768.0).copy()

    def _frame_to_beat(self, current_frame: int) -> float:
        convert_frame = getattr(self._matcher, "_convert_frame_to_beat", None)
        if callable(convert_frame):
            return float(convert_frame(current_frame))
        return float(current_frame)

    def _alignment_from_beat(self, beat_position: float) -> AlignmentUpdate | None:
        events = self.timeline["events"]
        if not events:
            return None

        closest_index = min(
            range(len(events)),
            key=lambda index: abs(events[index]["beat_position"] - beat_position),
        )
        next_index = max(self.current_event_index, closest_index)
        self.current_event_index = min(next_index, len(events) - 1)
        event = events[self.current_event_index]

        return {
            "event_index": event["event_index"],
            "measure_index": event["measure_index"],
            "measure_number": event["measure_number"],
            "beat_position": event["beat_position"],
            "confidence": self._confidence_for_event(event, beat_position),
            "timestamp_ms": self._timestamp_ms(),
            "score_completed": self.current_event_index >= len(events) - 1,
        }

    @staticmethod
    def _confidence_for_event(event: ScoreTimelineEvent, beat_position: float) -> float:
        distance = abs(event["beat_position"] - beat_position)
        return max(0.5, min(0.98, 0.98 - distance * 0.08))

    def _timestamp_ms(self) -> int:
        bytes_per_sample = 2
        frame_width = max(self.channels * bytes_per_sample, 1)
        total_samples = self.total_bytes / frame_width
        return int((total_samples / max(self.sample_rate, 1)) * 1000)

    @staticmethod
    def _create_silent_audio_file(sample_rate: int) -> str:
        temp_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        temp_file.close()
        with wave.open(temp_file.name, "wb") as audio_file:
            audio_file.setnchannels(1)
            audio_file.setsampwidth(2)
            audio_file.setframerate(sample_rate)
            audio_file.writeframes(b"\x00\x00" * sample_rate)
        return temp_file.name


def build_alignment_engine(
    engine_name: str,
    timeline: ScoreTimelineResult,
    score_file_path: str,
    sample_rate: int,
    channels: int,
    frame_format: str,
) -> AlignmentEngine:
    if engine_name != "matchmaker":
        raise ValueError(f"Unsupported practice alignment engine: {engine_name}")

    return MatchmakerLiveEngine(
        timeline=timeline,
        score_file_path=score_file_path,
        sample_rate=sample_rate,
        channels=channels,
        frame_format=frame_format,
    )
