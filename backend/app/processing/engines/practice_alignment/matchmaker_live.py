from __future__ import annotations

import queue
import threading
from pathlib import Path

from app.core.config import get_practice_runtime_settings
from app.core.logger import logger
from app.processing.resources import ensure_partitura_default_soundfont
from app.processing.engines.practice_alignment.audio_features import feature_matrix
from app.processing.engines.practice_alignment.alignment_metrics import (
    alignment_state,
    beat_velocity,
    continuity_state,
    validation_confidence_ceiling,
)
from app.processing.engines.practice_alignment.browser_audio_stream import BrowserAudioStreamAdapter, EnvironmentQuality
from app.processing.engines.practice_alignment.contracts import AlignmentEngine, AlignmentUpdate
from app.processing.engines.practice_alignment.profile import DEFAULT_PRACTICE_AUDIO_PROFILE
from app.processing.engines.practice_alignment.reference_runtime import (
    build_audio_processor,
    build_score_follower,
    generate_score_audio,
    normalize_audio_waveform,
)
from app.processing.engines.practice_alignment.stream_state import (
    STREAM_STATE_HOLDING_DECAY,
    STREAM_STATE_LOST,
)


DEFAULT_TEMPO_BPM = 120

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

        ensure_partitura_default_soundfont(get_practice_runtime_settings().PRACTICE_SOUNDFONT_PATH)
        try:
            import numpy as np
            import partitura
            from matchmaker.base import STREAM_END
            from matchmaker.dp import OnlineTimeWarpingArztFrame
            from matchmaker.features.audio import ChromagramProcessor
            from partitura.io.exportmidi import get_ppq
        except ImportError as exc:
            missing_module = getattr(exc, "name", None) or "unknown"
            raise RuntimeError(
                "Missing practice alignment dependency "
                f"'{missing_module}'. Install pymatchmaker and its runtime "
                f"dependencies before starting live practice sessions. Original error: {exc}"
            ) from exc
        score_audio_generator = None
        if not get_practice_runtime_settings().PRACTICE_SOUNDFONT_PATH:
            try:
                from matchmaker.utils import misc as matchmaker_misc

                score_audio_generator = matchmaker_misc.generate_score_audio
            except ImportError as exc:
                missing_module = getattr(exc, "name", None) or "unknown"
                raise RuntimeError(
                    "Missing practice alignment dependency "
                    f"'{missing_module}'. Install pymatchmaker and its runtime "
                    "dependencies before starting live practice sessions. "
                    f"Original error: {exc}"
                ) from exc

        self.score_file_path = str(Path(score_file_path))
        self.sample_rate = sample_rate
        self.channels = channels
        self.frame_format = frame_format
        self.total_bytes = 0
        self._last_beat_position: float | None = None
        self._last_alignment_timestamp_ms: int | None = None
        self._np = np
        self._get_ppq = get_ppq
        self._stream_end_marker = STREAM_END
        self._error: Exception | None = None
        self._closed = threading.Event()
        self._follower_finished = False
        self._updates: queue.Queue[AlignmentUpdate] = queue.Queue()
        self._worker: threading.Thread | None = None
        self._alignment_update_log_count = 0
        self._alignment_decision_log_count = 0
        self._start_alignment_emitted = False

        self.score_part = partitura.load_score_as_part(self.score_file_path)
        self._note_array = self.score_part.note_array()
        self._score_start_beat = self._calculate_score_start_beat(self._note_array)
        self._score_end_beat = self._calculate_score_end_beat(self._note_array)
        self.tempo = DEFAULT_TEMPO_BPM
        profile = DEFAULT_PRACTICE_AUDIO_PROFILE
        self.frame_rate = profile.frame_rate
        self.hop_length = max(int(sample_rate / self.frame_rate), 1)
        self._queue: queue.Queue[object] = queue.Queue()
        self._processor = build_audio_processor(
            sample_rate=sample_rate,
            hop_length=self.hop_length,
            chroma_processor=ChromagramProcessor,
        )
        settings = get_practice_runtime_settings()
        self._stream = BrowserAudioStreamAdapter(
            processor=self._processor,
            feature_queue=self._queue,
            np=np,
            hop_length=self.hop_length,
            rms_gate=profile.rms_gate,
            peak_gate=profile.peak_gate,
            start_rms_gate=profile.start_rms_gate,
            start_peak_gate=profile.start_peak_gate,
            min_active_frames=profile.min_active_frames,
            warmup_frames=profile.warmup_frames,
            rms_noise_multiplier=profile.rms_noise_multiplier,
            peak_noise_multiplier=profile.peak_noise_multiplier,
            diagnostics_enabled=settings.PRACTICE_AUDIO_DIAGNOSTICS,
            no_input_frames=profile.no_input_frames,
            tonal_gate_enabled=profile.tonal_gate_enabled,
            max_spectral_flatness=profile.max_spectral_flatness,
            min_peak_prominence=profile.min_peak_prominence,
            onset_flux_gate=profile.onset_flux_gate,
            onset_hold_frames=profile.onset_hold_frames,
            diagnostic_frame_interval=settings.PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL,
        )

        raw_score_audio = generate_score_audio(
            score=self.score_part,
            bpm=self.tempo,
            sample_rate=sample_rate,
            np=np,
            partitura=partitura,
            generate_score_audio=score_audio_generator,
        )
        score_audio = normalize_audio_waveform(raw_score_audio, np).astype(np.float32)
        reference_features = feature_matrix(self._processor((score_audio, 0.0)))
        if reference_features is None:
            raise RuntimeError("Score feature extraction returned no features.")
        if hasattr(self._processor, "reset"):
            self._processor.reset()
        ref_frame_to_beat = self._build_ref_frame_to_beat(reference_features)
        self._reference_features, self._ref_frame_to_beat = self._trim_reference_to_playable_start(
            reference_features,
            ref_frame_to_beat,
        )
        self._reference_end_beat = float(self._ref_frame_to_beat[-1])
        self._stream.start_feature_validator = self._is_valid_start_feature
        self._stream.start_feature_scorer = self._score_start_feature
        self._score_follower = build_score_follower(
            reference_features=self._reference_features,
            feature_queue=self._queue,
            frame_rate=self.frame_rate,
            arzt_follower=OnlineTimeWarpingArztFrame,
            ref_frame_to_beat=self._ref_frame_to_beat,
            score_positions=np.unique(self._note_array["onset_beat"]).astype(np.float32),
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

        if not getattr(self, "_start_alignment_emitted", True):
            self._start_alignment_emitted = True
            self._ensure_worker_started()
            return self._with_current_audio_state(self._start_alignment())

        latest = self._latest_pending_alignment()
        if latest is not None:
            return self._with_current_audio_state(latest)

        self._ensure_worker_started()

        latest = self._latest_pending_alignment()
        if latest is not None:
            latest = self._with_current_audio_state(latest)
        return latest

    @property
    def is_ready_for_performance(self) -> bool:
        return self._stream.armed

    @property
    def environment_quality(self) -> EnvironmentQuality:
        return self._stream.environment_quality

    def close(self) -> None:
        self._closed.set()
        self._queue.put(self._stream_end_marker)

    def _ensure_worker_started(self) -> None:
        if self._closed.is_set() or self._follower_finished:
            return
        if self._worker is not None and self._worker.is_alive():
            return

        self._worker = threading.Thread(
            target=self._run_follower,
            name=f"matchmaker-live-{Path(self.score_file_path).stem}",
            daemon=True,
        )
        self._worker.start()
        logger.bind(
            event="practice_matchmaker.started",
            frames=self._stream.total_frames,
            accepted=self._stream.accepted_frames,
            rejected=self._stream.rejected_frames,
            rms_gate=round(self._stream._calibrated_rms_gate, 5),
            peak_gate=round(self._stream._calibrated_peak_gate, 5),
        ).info("Practice matchmaker started")

    def _run_follower(self) -> None:
        try:
            for beat_position in self._score_follower.run(verbose=False):
                if self._closed.is_set():
                    break

                alignment = self._alignment_from_beat(float(beat_position))

                self._updates.put(alignment)
                if self._should_log_alignment_update():
                    logger.bind(
                        event="practice_alignment.update",
                        raw_beat=round(float(beat_position), 2),
                        beat=round(alignment["beat_position"], 2),
                        confidence=round(alignment["confidence"], 2),
                        completed=alignment["score_completed"],
                    ).info("Practice alignment update")
                if alignment["score_completed"]:
                    self._follower_finished = True
                    break
            else:
                if not self._closed.is_set():
                    self._follower_finished = True
        except queue.Empty:
            return
        except Exception as exc:  # pragma: no cover - depends on runtime package internals.
            self._error = exc

    def _latest_pending_alignment(self) -> AlignmentUpdate | None:
        latest: AlignmentUpdate | None = None
        while True:
            try:
                latest = self._updates.get_nowait()
            except queue.Empty:
                return latest

    def _pcm_s16le_to_float32(self, chunk: bytes):
        samples = self._np.frombuffer(chunk, dtype=self._np.int16)
        return (samples.astype(self._np.float32) / 32768.0).copy()

    def _build_ref_frame_to_beat(self, reference_features):
        frame_count = int(reference_features.shape[0])
        return self._np.array(
            [self._frame_to_beat(frame_index) for frame_index in range(frame_count)],
            dtype=self._np.float32,
        )

    def _trim_reference_to_playable_start(self, reference_features, ref_frame_to_beat):
        """Drop score-only leading rests that the browser never sends to OLTW."""
        beats = self._np.asarray(ref_frame_to_beat, dtype=self._np.float32)
        features = self._np.asarray(reference_features)
        indices = self._np.flatnonzero(beats >= self._score_start_beat)
        if indices.size == 0:
            return features, beats

        start_index = int(indices[0])
        return features[start_index:], beats[start_index:]

    def _frame_to_beat(self, current_frame: int) -> float:
        tick = self._get_ppq(self.score_part)
        timeline_time = (current_frame / self.frame_rate) * tick * (self.tempo / 60)
        return float(self._np.round(self.score_part.beat_map(timeline_time), decimals=2))

    def _alignment_from_beat(self, beat_position: float) -> AlignmentUpdate:
        previous_beat_position = self._last_beat_position
        previous_timestamp_ms = getattr(self, "_last_alignment_timestamp_ms", None)
        timestamp_ms = self._timestamp_ms()
        alignment_confidence = self._confidence_for_beat(beat_position)
        continuity_confidence = self._continuity_confidence_for_beat(beat_position)
        confidence = min(alignment_confidence, continuity_confidence)
        self._last_beat_position = beat_position
        self._last_alignment_timestamp_ms = timestamp_ms
        beat_delta = (
            None
            if previous_beat_position is None
            else round(beat_position - previous_beat_position, 3)
        )
        beat_velocity_value = beat_velocity(
            beat_delta=beat_delta,
            timestamp_ms=timestamp_ms,
            previous_timestamp_ms=previous_timestamp_ms,
        )
        continuity_status = continuity_state(beat_delta)
        return {
            "beat_position": round(beat_position, 3),
            "confidence": confidence,
            "alignment_confidence": alignment_confidence,
            "audio_confidence": 1.0,
            "continuity_confidence": continuity_confidence,
            "visual_confidence": confidence,
            "timestamp_ms": timestamp_ms,
            "score_completed": self._score_completed(beat_position),
            "audio_active": True,
            "input_rms": 0.0,
            "input_peak": 0.0,
            "match_state": "matched",
            "feature_confidence": 1.0,
            "beat_delta": beat_delta,
            "continuity_state": continuity_status,
            "beat_velocity": beat_velocity_value,
        }

    def _start_alignment(self) -> AlignmentUpdate:
        """Anchor the UI to the first played note once its feature is confirmed."""
        return self._alignment_from_beat(self._score_start_beat)

    def _with_current_audio_state(self, alignment: AlignmentUpdate) -> AlignmentUpdate:
        audio_confidence = self._stream.activity_confidence_ceiling
        feature_confidence = self._feature_confidence_for_beat(alignment["beat_position"])
        alignment_confidence = min(alignment["alignment_confidence"], feature_confidence)
        continuity_confidence = alignment["continuity_confidence"]
        alignment_status = alignment_state(
            raw_alignment_confidence=alignment["alignment_confidence"],
            feature_confidence=feature_confidence,
        )
        continuity_status = alignment.get("continuity_state") or continuity_state(
            alignment.get("beat_delta"),
        )
        validation_confidence = validation_confidence_ceiling(
            alignment_state=alignment_status,
            continuity_state=continuity_status,
        )
        input_policy_confidence = getattr(self._stream, "last_input_policy_confidence", 1.0)
        confidence = min(
            alignment_confidence,
            continuity_confidence,
            audio_confidence,
            validation_confidence,
            input_policy_confidence,
        )
        if self._stream.last_audio_active:
            match_state = "matched"
        elif self._stream.stream_state == STREAM_STATE_HOLDING_DECAY:
            match_state = "holding_decay"
        elif self._stream.stream_state == STREAM_STATE_LOST:
            match_state = "lost"
        else:
            match_state = "no_input"
        update: AlignmentUpdate = {
            **alignment,
            "confidence": round(confidence, 3),
            "alignment_confidence": round(alignment_confidence, 3),
            "audio_confidence": round(audio_confidence, 3),
            "continuity_confidence": round(continuity_confidence, 3),
            "visual_confidence": round(confidence, 3),
            "audio_active": self._stream.last_audio_active,
            "input_rms": round(self._stream.last_rms, 5),
            "input_peak": round(self._stream.last_peak, 5),
            "match_state": match_state,
            "feature_confidence": round(feature_confidence, 3),
            "stream_state": self._stream.stream_state,
            "frame_class": getattr(self._stream, "last_frame_class", "unknown"),
            "gate_reason": getattr(self._stream, "last_gate_reason", "unknown"),
            "queue_decision": getattr(self._stream, "last_queue_decision", "unknown"),
            "tonal_signal": getattr(self._stream, "last_tonal_signal", False),
            "onset_signal": getattr(self._stream, "last_onset_signal", False),
            "spectral_flatness": round(
                getattr(self._stream, "last_spectral_flatness", 1.0),
                5,
            ),
            "peak_prominence": round(
                getattr(self._stream, "last_peak_prominence", 0.0),
                2,
            ),
            "spectral_flux": round(getattr(self._stream, "last_spectral_flux", 0.0), 5),
            "alignment_state": alignment_status,
            "continuity_state": continuity_status,
            "beat_velocity": alignment.get("beat_velocity"),
            "validation_confidence": round(validation_confidence, 3),
            "input_weight": round(getattr(self._stream, "last_input_weight", 0.0), 3),
            "input_policy_confidence": round(input_policy_confidence, 3),
        }
        if self._should_log_alignment_decision():
            logger.bind(
                event="practice_alignment.decision",
                beat=round(update["beat_position"], 2),
                beat_delta=update.get("beat_delta"),
                match_state=update["match_state"],
                confidence=round(update["confidence"], 3),
                alignment_confidence=round(update["alignment_confidence"], 3),
                feature_confidence=round(update["feature_confidence"], 3),
                audio_confidence=round(update["audio_confidence"], 3),
                continuity_confidence=round(update["continuity_confidence"], 3),
                validation_confidence=round(update["validation_confidence"], 3),
                input_policy_confidence=round(update["input_policy_confidence"], 3),
                alignment_state=update["alignment_state"],
                continuity_state=update["continuity_state"],
                beat_velocity=update.get("beat_velocity"),
                frame_class=update["frame_class"],
                gate_reason=update["gate_reason"],
                queue_decision=update["queue_decision"],
            ).info("Practice alignment decision")
        return update

    def _should_log_alignment_update(self) -> bool:
        settings = get_practice_runtime_settings()
        if not settings.PRACTICE_AUDIO_DIAGNOSTICS:
            return False
        update_count = getattr(self, "_alignment_update_log_count", 0) + 1
        self._alignment_update_log_count = update_count
        interval = max(settings.PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL, 1)
        return update_count == 1 or update_count % interval == 0

    def _should_log_alignment_decision(self) -> bool:
        settings = get_practice_runtime_settings()
        if not settings.PRACTICE_AUDIO_DIAGNOSTICS:
            return False
        decision_count = getattr(self, "_alignment_decision_log_count", 0) + 1
        self._alignment_decision_log_count = decision_count
        interval = max(settings.PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL, 1)
        return decision_count == 1 or decision_count % interval == 0

    def _is_valid_start_feature(self, feature_vector) -> bool:
        return self._score_start_feature(feature_vector) >= 0.7

    def _score_start_feature(self, feature_vector) -> float:
        return self._feature_confidence_for_beat(
            self._score_start_beat,
            current_feature=feature_vector,
            missing_confidence=0.0,
        )

    def _feature_confidence_for_beat(
        self,
        beat_position: float,
        *,
        current_feature=None,
        missing_confidence: float = 1.0,
    ) -> float:
        if current_feature is None:
            current_feature = getattr(self._stream, "last_feature_vector", None)
        reference_features = getattr(self, "_reference_features", None)
        ref_frame_to_beat = getattr(self, "_ref_frame_to_beat", None)
        if current_feature is None or reference_features is None or ref_frame_to_beat is None:
            return missing_confidence

        reference_array = self._np.asarray(reference_features, dtype=float)
        beat_array = self._np.asarray(ref_frame_to_beat, dtype=float)
        if reference_array.size == 0 or beat_array.size == 0:
            return 1.0

        ref_index = int(self._np.argmin(self._np.abs(beat_array - beat_position)))
        reference_feature = reference_array[min(ref_index, reference_array.shape[0] - 1)]
        current = self._np.ravel(self._np.asarray(current_feature, dtype=float))
        reference = self._np.ravel(reference_feature)
        if current.size == 0 or reference.size == 0:
            return 1.0

        size = min(current.size, reference.size)
        current = current[:size]
        reference = reference[:size]
        if not self._np.isfinite(current).all() or not self._np.isfinite(reference).all():
            return 0.0
        current_norm = float(self._np.linalg.norm(current))
        reference_norm = float(self._np.linalg.norm(reference))
        if current_norm <= 1e-9 or reference_norm <= 1e-9:
            return 0.0

        similarity = float(self._np.dot(current, reference) / (current_norm * reference_norm))
        if not self._np.isfinite(similarity):
            return 0.0
        similarity = max(0.0, min(1.0, similarity))
        return max(0.0, min(1.0, (similarity - 0.72) / 0.18))

    def _confidence_for_beat(self, beat_position: float) -> float:
        if self._last_beat_position is None:
            return 0.9

        delta = beat_position - self._last_beat_position
        if delta < -0.5:
            return 0.45
        if delta < -0.1:
            return 0.65
        return 0.95

    def _continuity_confidence_for_beat(self, beat_position: float) -> float:
        if self._last_beat_position is None:
            return 0.9

        delta = beat_position - self._last_beat_position
        if delta < -0.5:
            return 0.3
        if delta < -0.1:
            return 0.65
        if delta > 8.0:
            return 0.35
        if delta > 4.0:
            return 0.7
        return 0.95

    def _score_completed(self, beat_position: float) -> bool:
        end_beat = self._reference_end_beat or self._score_end_beat
        return end_beat > 0 and beat_position >= end_beat - 0.25

    @staticmethod
    def _calculate_score_start_beat(note_array) -> float:
        names = note_array.dtype.names or ()
        if "onset_beat" not in names or len(note_array) == 0:
            return 0.0
        return float(note_array["onset_beat"].min())

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
    score_file_path: str,
    sample_rate: int,
    channels: int,
    frame_format: str,
) -> AlignmentEngine:
    return MatchmakerLiveEngine(
        score_file_path=score_file_path,
        sample_rate=sample_rate,
        channels=channels,
        frame_format=frame_format,
    )
