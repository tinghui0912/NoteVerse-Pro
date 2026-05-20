from __future__ import annotations

import queue
import threading
import time
from pathlib import Path
from typing import Protocol, TypedDict, runtime_checkable

from app.core.config import settings
from app.core.logger import logger


DEFAULT_TEMPO_BPM = 120


class AlignmentUpdate(TypedDict):
    beat_position: float
    confidence: float
    timestamp_ms: int
    score_completed: bool


@runtime_checkable
class AlignmentEngine(Protocol):
    """Realtime alignment engine that consumes browser-provided audio chunks."""

    def ingest_audio(self, chunk: bytes) -> AlignmentUpdate | None:
        ...

    @property
    def is_ready_for_performance(self) -> bool:
        ...

    def close(self) -> None:
        ...


class BrowserAudioStreamAdapter:
    """Small adapter that feeds browser PCM frames into Matchmaker's queue."""

    def __init__(
        self,
        processor,
        feature_queue,
        np,
        hop_length: int,
        rms_gate: float,
        peak_gate: float,
        start_rms_gate: float,
        start_peak_gate: float,
        min_active_frames: int,
        warmup_frames: int,
        rms_noise_multiplier: float,
        peak_noise_multiplier: float,
        diagnostics_enabled: bool,
    ) -> None:
        self.processor = processor
        self.queue = feature_queue
        self.np = np
        self.hop_length = hop_length
        self.rms_gate = rms_gate
        self.peak_gate = peak_gate
        self.start_rms_gate = start_rms_gate
        self.start_peak_gate = start_peak_gate
        self.min_active_frames = min_active_frames
        self.warmup_frames = warmup_frames
        self.rms_noise_multiplier = rms_noise_multiplier
        self.peak_noise_multiplier = peak_noise_multiplier
        self.diagnostics_enabled = diagnostics_enabled
        self.last_chunk = None
        self.armed = warmup_frames <= 0
        self.started = False
        self.total_frames = 0
        self.accepted_frames = 0
        self.rejected_frames = 0
        self.active_streak = 0
        self.start_streak = 0
        self._noise_rms_values: list[float] = []
        self._noise_peak_values: list[float] = []
        self._calibrated_rms_gate = rms_gate
        self._calibrated_peak_gate = peak_gate

    def ingest(self, audio_frame) -> bool:
        self.total_frames += 1
        rms, peak = self._measure_signal(audio_frame) if audio_frame.size else (0.0, 0.0)
        has_start_signal = self._has_start_signal(rms, peak)
        if self.total_frames <= self.warmup_frames:
            self._collect_noise_floor(rms, peak)
            self.rejected_frames += 1
            self.active_streak = 0
            self._log_diagnostics("warmup", rms, peak)
            return False

        if not self.armed:
            if audio_frame.size == 0 or not self._has_enough_signal(rms, peak):
                self.armed = True
            self.rejected_frames += 1
            self.active_streak = 0
            self._log_diagnostics("arming", rms, peak)
            return False

        if not self.started:
            if audio_frame.size == 0 or not self._has_enough_signal(rms, peak):
                self.rejected_frames += 1
                self.active_streak = 0
                self._log_diagnostics("rejected", rms, peak)
                return False

            if has_start_signal:
                self.start_streak += 1
            else:
                self.start_streak = 0
        elif audio_frame.size == 0:
            self.rejected_frames += 1
            self.active_streak = 0
            self._log_diagnostics("rejected", rms, peak)
            return False

        if self.last_chunk is None:
            target_audio = self.np.concatenate(
                (self.np.zeros(self.hop_length, dtype=self.np.float32), audio_frame)
            )
        else:
            target_audio = self.np.concatenate((self.last_chunk, audio_frame))

        features = self.processor(target_audio)
        if not self.started and self.start_streak >= self.min_active_frames:
            self.started = True

        if self.last_chunk is not None and self.started:
            self.queue.put((features, time.perf_counter()))

        self.last_chunk = target_audio[-self.hop_length :]
        self.accepted_frames += 1
        self.active_streak += 1
        self._log_diagnostics("accepted", rms, peak)
        return True

    @property
    def ready_to_start(self) -> bool:
        return self.started

    def _has_enough_signal(self, rms: float, peak: float) -> bool:
        return rms >= self._calibrated_rms_gate and peak >= self._calibrated_peak_gate

    def _has_start_signal(self, rms: float, peak: float) -> bool:
        rms_gate, peak_gate = self._effective_start_gates()
        return rms >= rms_gate and peak >= peak_gate

    def _collect_noise_floor(self, rms: float, peak: float) -> None:
        if not self._is_noise_floor_candidate(rms, peak):
            return

        self._noise_rms_values.append(rms)
        self._noise_peak_values.append(peak)
        self._refresh_calibrated_gates()

    def _is_noise_floor_candidate(self, rms: float, peak: float) -> bool:
        return rms <= self.rms_gate * 0.75 and peak <= self.peak_gate * 0.75

    def _effective_start_gates(self) -> tuple[float, float]:
        rms_gate = min(
            self.start_rms_gate,
            max(self.rms_gate * 2.0, self._calibrated_rms_gate * 1.25),
        )
        peak_gate = min(
            self.start_peak_gate,
            max(self.peak_gate * 1.4, self._calibrated_peak_gate * 1.15),
        )
        return rms_gate, peak_gate

    def _refresh_calibrated_gates(self) -> None:
        if not self._noise_rms_values or not self._noise_peak_values:
            return

        rms_floor = float(self.np.percentile(self._noise_rms_values, 90))
        peak_floor = float(self.np.percentile(self._noise_peak_values, 90))
        self._calibrated_rms_gate = max(
            self.rms_gate,
            rms_floor * self.rms_noise_multiplier,
        )
        self._calibrated_peak_gate = max(
            self.peak_gate,
            peak_floor * self.peak_noise_multiplier,
        )

    def _measure_signal(self, audio_frame) -> tuple[float, float]:
        rms = float(self.np.sqrt(self.np.mean(self.np.square(audio_frame))))
        peak = float(self.np.max(self.np.abs(audio_frame)))
        return rms, peak

    def _log_diagnostics(self, decision: str, rms: float, peak: float) -> None:
        if not self.diagnostics_enabled:
            return

        should_log = (
            decision == "accepted"
            or self.total_frames <= self.warmup_frames
            or self.total_frames % 15 == 0
        )
        if not should_log:
            return

        effective_start_rms_gate, effective_start_peak_gate = self._effective_start_gates()
        logger.info(
            "practice_audio_gate "
            f"decision={decision} "
            f"frame={self.total_frames} "
            f"rms={rms:.5f} "
            f"peak={peak:.5f} "
            f"rms_gate={self._calibrated_rms_gate:.5f} "
            f"peak_gate={self._calibrated_peak_gate:.5f} "
            f"start_rms_gate={self.start_rms_gate:.5f} "
            f"start_peak_gate={self.start_peak_gate:.5f} "
            f"effective_start_rms_gate={effective_start_rms_gate:.5f} "
            f"effective_start_peak_gate={effective_start_peak_gate:.5f} "
            f"armed={self.armed} "
            f"active_streak={self.active_streak} "
            f"start_streak={self.start_streak} "
            f"accepted={self.accepted_frames} "
            f"rejected={self.rejected_frames} "
            f"noise_samples={len(self._noise_rms_values)} "
            f"ready={self.ready_to_start}"
        )


class MatchmakerLiveEngine:
    """Matchmaker-backed live engine for browser WebSocket PCM streams."""

    def __init__(
        self,
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
            import partitura
            from matchmaker.dp import OnlineTimeWarpingArzt
            from matchmaker.features.audio import (
                ChromagramProcessor,
                LogSpectralEnergyProcessor,
            )
            from matchmaker.utils.misc import RECVQueue, generate_score_audio
            from partitura.io.exportmidi import get_ppq
        except ImportError as exc:
            raise RuntimeError(
                "pymatchmaker and its runtime dependencies must be installed "
                "before starting live practice sessions."
            ) from exc

        self.score_file_path = str(Path(score_file_path))
        self.sample_rate = sample_rate
        self.channels = channels
        self.frame_format = frame_format
        self.total_bytes = 0
        self._last_beat_position: float | None = None
        self._np = np
        self._get_ppq = get_ppq
        self._error: Exception | None = None
        self._closed = threading.Event()
        self._updates: queue.Queue[AlignmentUpdate] = queue.Queue()
        self._worker: threading.Thread | None = None

        self.score_part = partitura.load_score_as_part(self.score_file_path)
        self._note_array = self.score_part.note_array()
        self._score_end_beat = self._calculate_score_end_beat(self._note_array)
        self.tempo = DEFAULT_TEMPO_BPM
        self.frame_rate = settings.PRACTICE_MATCHMAKER_FRAME_RATE
        self.hop_length = max(int(sample_rate / self.frame_rate), 1)
        self._queue = RECVQueue()
        self._processor = self._build_audio_processor(
            feature_type=settings.PRACTICE_MATCHMAKER_FEATURE_TYPE,
            sample_rate=sample_rate,
            hop_length=self.hop_length,
            chroma_processor=ChromagramProcessor,
            lse_processor=LogSpectralEnergyProcessor,
        )
        self._stream = BrowserAudioStreamAdapter(
            processor=self._processor,
            feature_queue=self._queue,
            np=np,
            hop_length=self.hop_length,
            rms_gate=settings.PRACTICE_AUDIO_RMS_GATE,
            peak_gate=settings.PRACTICE_AUDIO_PEAK_GATE,
            start_rms_gate=settings.PRACTICE_AUDIO_START_RMS_GATE,
            start_peak_gate=settings.PRACTICE_AUDIO_START_PEAK_GATE,
            min_active_frames=settings.PRACTICE_AUDIO_MIN_ACTIVE_FRAMES,
            warmup_frames=settings.PRACTICE_AUDIO_WARMUP_FRAMES,
            rms_noise_multiplier=settings.PRACTICE_AUDIO_RMS_NOISE_MULTIPLIER,
            peak_noise_multiplier=settings.PRACTICE_AUDIO_PEAK_NOISE_MULTIPLIER,
            diagnostics_enabled=settings.PRACTICE_AUDIO_DIAGNOSTICS,
        )

        score_audio = generate_score_audio(
            self.score_part,
            self.tempo,
            sample_rate,
        ).astype(np.float32)
        reference_features = self._processor(score_audio)
        if hasattr(self._processor, "reset"):
            self._processor.reset()
        self._score_follower = self._build_score_follower(
            method=settings.PRACTICE_MATCHMAKER_METHOD,
            reference_features=reference_features,
            feature_queue=self._queue,
            frame_rate=self.frame_rate,
            arzt_follower=OnlineTimeWarpingArzt,
            ref_frame_to_beat=self._build_ref_frame_to_beat(reference_features),
            state_space=np.unique(self._note_array["onset_beat"]),
        )

    def ingest_audio(self, chunk: bytes) -> AlignmentUpdate | None:
        if self._error is not None:
            raise RuntimeError(str(self._error)) from self._error
        if not chunk:
            return None

        self.total_bytes += len(chunk)
        audio_frame = self._pcm_s16le_to_float32(chunk)
        if not self._stream.ingest(audio_frame):
            return None
        if not self._stream.ready_to_start:
            return None

        self._ensure_worker_started()

        latest: AlignmentUpdate | None = None
        while True:
            try:
                latest = self._updates.get_nowait()
            except queue.Empty:
                break
        return latest

    @property
    def is_ready_for_performance(self) -> bool:
        return self._stream.armed

    def close(self) -> None:
        self._closed.set()

    def _ensure_worker_started(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return

        self._worker = threading.Thread(
            target=self._run_follower,
            name=f"matchmaker-live-{Path(self.score_file_path).stem}",
            daemon=True,
        )
        self._worker.start()
        logger.info(
            "practice_matchmaker_started "
            f"frames={self._stream.total_frames} "
            f"accepted={self._stream.accepted_frames} "
            f"rejected={self._stream.rejected_frames} "
            f"rms_gate={self._stream._calibrated_rms_gate:.5f} "
            f"peak_gate={self._stream._calibrated_peak_gate:.5f}"
        )

    def _run_follower(self) -> None:
        try:
            for beat_position in self._score_follower.run(verbose=False):
                if self._closed.is_set():
                    break

                alignment = self._alignment_from_beat(float(beat_position))

                self._updates.put(alignment)
                if settings.PRACTICE_AUDIO_DIAGNOSTICS:
                    logger.info(
                        "practice_alignment_update "
                        f"raw_beat={beat_position:.2f} "
                        f"beat={alignment['beat_position']:.2f} "
                        f"confidence={alignment['confidence']:.2f} "
                        f"completed={alignment['score_completed']}"
                    )
                if alignment["score_completed"]:
                    break
        except queue.Empty:
            return
        except Exception as exc:  # pragma: no cover - depends on runtime package internals.
            self._error = exc

    def _pcm_s16le_to_float32(self, chunk: bytes):
        samples = self._np.frombuffer(chunk, dtype=self._np.int16)
        return (samples.astype(self._np.float32) / 32768.0).copy()

    @staticmethod
    def _build_audio_processor(
        feature_type: str,
        sample_rate: int,
        hop_length: int,
        chroma_processor,
        lse_processor,
    ):
        if feature_type == "chroma":
            return chroma_processor(sample_rate=sample_rate, hop_length=hop_length)
        if feature_type == "lse":
            return lse_processor(sample_rate=sample_rate, hop_length=hop_length)
        raise RuntimeError(f"Unsupported Matchmaker audio feature type: {feature_type}")

    @staticmethod
    def _build_score_follower(
        method: str,
        reference_features,
        feature_queue,
        frame_rate: int,
        arzt_follower,
        ref_frame_to_beat=None,
        state_space=None,
    ):
        if method == "arzt":
            return arzt_follower(
                reference_features=reference_features,
                queue=feature_queue,
                distance_func=arzt_follower.DEFAULT_DISTANCE_FUNC,
                frame_rate=frame_rate,
                ref_frame_to_beat=ref_frame_to_beat,
                state_space=state_space,
            )
        raise RuntimeError(f"Unsupported Matchmaker method: {method}")

    def _build_ref_frame_to_beat(self, reference_features):
        frame_count = int(reference_features.shape[0])
        return self._np.array(
            [self._frame_to_beat(frame_index) for frame_index in range(frame_count)],
            dtype=self._np.float32,
        )

    def _frame_to_beat(self, current_frame: int) -> float:
        tick = self._get_ppq(self.score_part)
        timeline_time = (current_frame / self.frame_rate) * tick * (self.tempo / 60)
        return float(self._np.round(self.score_part.beat_map(timeline_time), decimals=2))

    def _alignment_from_beat(self, beat_position: float) -> AlignmentUpdate:
        confidence = self._confidence_for_beat(beat_position)
        self._last_beat_position = beat_position
        return {
            "beat_position": round(beat_position, 3),
            "confidence": confidence,
            "timestamp_ms": self._timestamp_ms(),
            "score_completed": self._score_completed(beat_position),
        }

    def _confidence_for_beat(self, beat_position: float) -> float:
        if self._last_beat_position is None:
            return 0.9

        delta = beat_position - self._last_beat_position
        if delta < -0.5:
            return 0.45
        if delta < -0.1:
            return 0.65
        return 0.95

    def _score_completed(self, beat_position: float) -> bool:
        return self._score_end_beat > 0 and beat_position >= self._score_end_beat - 0.25

    @staticmethod
    def _calculate_score_end_beat(note_array) -> float:
        names = note_array.dtype.names or ()
        if "onset_beat" not in names or len(note_array) == 0:
            return 0.0

        onset_beats = note_array["onset_beat"]
        if "duration_beat" in names:
            end_beats = onset_beats + note_array["duration_beat"]
        else:
            end_beats = onset_beats
        return float(end_beats.max())

    def _timestamp_ms(self) -> int:
        bytes_per_sample = 2
        frame_width = max(self.channels * bytes_per_sample, 1)
        total_samples = self.total_bytes / frame_width
        return int((total_samples / max(self.sample_rate, 1)) * 1000)


def build_alignment_engine(
    engine_name: str,
    score_file_path: str,
    sample_rate: int,
    channels: int,
    frame_format: str,
) -> AlignmentEngine:
    if engine_name != "matchmaker":
        raise ValueError(f"Unsupported practice alignment engine: {engine_name}")

    return MatchmakerLiveEngine(
        score_file_path=score_file_path,
        sample_rate=sample_rate,
        channels=channels,
        frame_format=frame_format,
    )
