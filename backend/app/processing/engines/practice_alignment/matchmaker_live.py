from __future__ import annotations

import queue
import threading
import time
from pathlib import Path
from typing import Callable, Literal

from app.core.config import get_practice_runtime_settings
from app.core.logger import logger
from app.processing.resources import ensure_partitura_default_soundfont
from app.processing.engines.practice_alignment.audio_diagnostics import log_audio_gate_diagnostic
from app.processing.engines.practice_alignment.audio_activity import (
    ActivityConfidenceEstimator,
    AdaptiveNoiseCalibrator,
    AudioFrameClass,
    AudioGateConfig,
    AudioFeatureExtractor,
    AudioFrameFeatures,
    OltwInputPolicy,
    PracticeAudioGate,
    PracticeActivityStateMachine,
)
from app.processing.engines.practice_alignment.contracts import AlignmentEngine, AlignmentUpdate
from app.processing.engines.practice_alignment.profile import DEFAULT_PRACTICE_AUDIO_PROFILE
from app.processing.engines.practice_alignment.reference_runtime import (
    build_audio_processor,
    build_score_follower,
    generate_score_audio,
    normalize_audio_waveform,
)
from app.processing.engines.practice_alignment.stream_state import (
    STREAM_STATE_ARMED,
    STREAM_STATE_CALIBRATING,
    STREAM_STATE_HOLDING_DECAY,
    STREAM_STATE_LOST,
)


DEFAULT_TEMPO_BPM = 120

EnvironmentQuality = Literal["good", "noisy", "poor"]

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
        no_input_frames: int = 24,
        tonal_gate_enabled: bool = True,
        max_spectral_flatness: float = 0.35,
        min_peak_prominence: float = 8.0,
        onset_flux_gate: float = 0.35,
        onset_hold_frames: int = 45,
        diagnostic_frame_interval: int = 15,
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
        self.tonal_gate_enabled = tonal_gate_enabled
        self.max_spectral_flatness = max_spectral_flatness
        self.min_peak_prominence = min_peak_prominence
        self.onset_flux_gate = onset_flux_gate
        self.onset_hold_frames = max(onset_hold_frames, 1)
        self.diagnostics_enabled = diagnostics_enabled
        self.diagnostic_frame_interval = max(diagnostic_frame_interval, 1)
        self.no_input_frames = max(no_input_frames, 1)
        self.feature_extractor = AudioFeatureExtractor(
            np=np,
            tonal_gate_enabled=tonal_gate_enabled,
            max_spectral_flatness=max_spectral_flatness,
            min_peak_prominence=min_peak_prominence,
        )
        self.audio_gate = PracticeAudioGate(
            AudioGateConfig(
                rms_gate=rms_gate,
                peak_gate=peak_gate,
                start_rms_gate=start_rms_gate,
                start_peak_gate=start_peak_gate,
                min_peak_prominence=min_peak_prominence,
                onset_hold_frames=self.onset_hold_frames,
            )
        )
        self.oltw_input_policy = OltwInputPolicy()
        self.calibrator = AdaptiveNoiseCalibrator(
            np=np,
            rms_gate=rms_gate,
            peak_gate=peak_gate,
            onset_flux_gate=onset_flux_gate,
            rms_noise_multiplier=rms_noise_multiplier,
            peak_noise_multiplier=peak_noise_multiplier,
        )
        self.activity_state = PracticeActivityStateMachine(
            warmup_frames=warmup_frames,
            no_input_frames=no_input_frames,
        )
        self.last_chunk = None
        self.last_rms = 0.0
        self.last_peak = 0.0
        self.last_tonal_signal = False
        self.last_spectral_flatness = 1.0
        self.last_peak_prominence = 0.0
        self.last_spectral_flux = 0.0
        self.last_onset_signal = False
        self.last_frame_class: AudioFrameClass = "silence"
        self.last_feature_vector = None
        self.start_feature_validator: Callable[[object], bool] | None = None
        self.start_feature_scorer: Callable[[object], float] | None = None
        self.last_gate_reason = "initialized"
        self.last_queue_decision = "not_started"
        self.last_input_weight = 0.0
        self.last_input_policy_confidence = 0.0
        self.last_start_signal_reason = "none"
        self.last_runtime_activity_reason = "not_started"
        self.last_start_feature_confidence: float | None = None
        self._warmup_rms_values: list[float] = []
        self._warmup_peak_values: list[float] = []

    @property
    def session_keepalive_frames(self) -> int:
        return max(
            self.onset_hold_frames * 2,
            self.onset_hold_frames + self.no_input_frames,
        )

    def ingest(self, audio_frame) -> bool:
        self.activity_state.begin_frame()
        frame_features = self.feature_extractor.extract(
            audio_frame,
            rms_gate=self.rms_gate,
            peak_gate=self.peak_gate,
            calibrated_flux_gate=self._calibrated_flux_gate,
        )
        self._set_last_features(frame_features)
        rms = frame_features.rms
        peak = frame_features.peak
        self.last_rms = rms
        self.last_peak = peak
        self.last_audio_active = False
        self.last_queue_decision = "not_started"
        self.last_input_weight = 0.0
        self.last_input_policy_confidence = 0.0
        self.last_gate_reason = "evaluating"
        self.last_start_feature_confidence = None
        self.last_frame_class = frame_features.frame_class
        has_start_signal, self.last_start_signal_reason = self._start_signal_result(
            rms,
            peak,
        )
        if self.total_frames <= self.warmup_frames:
            self._record_warmup_signal(rms, peak)
            self._collect_noise_floor(rms, peak)
            self.activity_state.reject(STREAM_STATE_CALIBRATING)
            if self.total_frames == self.warmup_frames:
                self.activity_state.mark_armed()
            self.last_gate_reason = "warmup_calibration"
            self.last_queue_decision = "warmup"
            self._log_diagnostics("warmup", rms, peak)
            return False

        if not self.started:
            self.stream_state = STREAM_STATE_ARMED
            self._maybe_update_runtime_noise_floor(rms, peak)
            if audio_frame.size == 0 or not has_start_signal:
                self.activity_state.clear_start_signal()
                self.activity_state.reject()
                self.last_gate_reason = (
                    "empty_frame" if audio_frame.size == 0 else self.last_start_signal_reason
                )
                self.last_queue_decision = "waiting_for_start"
                self._log_diagnostics("rejected", rms, peak)
                return False

            if has_start_signal:
                self.activity_state.mark_start_signal(self.last_onset_signal)
            else:
                self.activity_state.clear_start_signal()
        elif audio_frame.size == 0:
            self.activity_state.reject()
            self.last_gate_reason = "empty_frame"
            self.last_queue_decision = "empty_frame"
            self._log_diagnostics("rejected", rms, peak)
            return False

        if self.last_chunk is None:
            target_audio = self.np.concatenate(
                (self.np.zeros(self.hop_length, dtype=self.np.float32), audio_frame)
            )
        else:
            target_audio = self.np.concatenate((self.last_chunk, audio_frame))

        feature_time = time.perf_counter()
        features = self._feature_matrix(self.processor((target_audio, feature_time)))
        if features is None:
            self.last_chunk = target_audio[-self.hop_length :]
            self.last_gate_reason = "feature_buffering"
            self.last_queue_decision = "feature_buffering"
            self._log_diagnostics("feature_buffering", rms, peak)
            return False
        self.last_feature_vector = self._latest_feature_vector(features)
        if not self.started and self.start_streak >= self.min_active_frames:
            self.last_start_feature_confidence = self._score_start_feature(
                self.last_feature_vector,
            )
            if (
                self.last_start_feature_confidence is not None
                and self.last_start_feature_confidence < 0.7
            ):
                self.activity_state.clear_start_signal()
                self._maybe_update_runtime_noise_floor(rms, peak)
                self.last_chunk = target_audio[-self.hop_length :]
                self.activity_state.reject(STREAM_STATE_ARMED)
                self.last_gate_reason = "start_feature_mismatch"
                self.last_queue_decision = "start_rejected"
                self._log_diagnostics("start_rejected", rms, peak)
                return False
            self.activity_state.mark_started(self.last_onset_signal)
            self.last_gate_reason = "start_confirmed"

        runtime_active = False
        if self.started:
            runtime_active, self.last_runtime_activity_reason = self._runtime_activity_result(
                rms,
                peak,
            )
            self._update_runtime_activity(rms, peak, runtime_active)
            self.last_audio_active = runtime_active
            if not runtime_active:
                self._maybe_update_runtime_noise_floor(rms, peak)

        queue_decision = self.oltw_input_policy.decide(
            started=self.started,
            has_previous_chunk=self.last_chunk is not None,
            runtime_active=runtime_active,
            frame_class=self.last_frame_class,
        )
        if queue_decision.should_queue:
            self.queue.put((features, feature_time))
        self.last_queue_decision = queue_decision.reason
        self.last_input_weight = queue_decision.input_weight
        self.last_input_policy_confidence = queue_decision.confidence_ceiling

        self.last_chunk = target_audio[-self.hop_length :]
        self.activity_state.accept()
        if self.started and self.last_gate_reason != "start_confirmed":
            self.last_gate_reason = self.last_runtime_activity_reason
        self._log_diagnostics("accepted", rms, peak)
        return True

    @property
    def ready_to_start(self) -> bool:
        return self.activity_state.ready_to_start

    @property
    def armed(self) -> bool:
        return self.activity_state.armed

    @armed.setter
    def armed(self, value: bool) -> None:
        self.activity_state.armed = value

    @property
    def started(self) -> bool:
        return self.activity_state.started

    @started.setter
    def started(self, value: bool) -> None:
        self.activity_state.started = value

    @property
    def performance_active(self) -> bool:
        return self.activity_state.performance_active

    @performance_active.setter
    def performance_active(self, value: bool) -> None:
        self.activity_state.performance_active = value

    @property
    def stream_state(self) -> str:
        return self.activity_state.stream_state

    @stream_state.setter
    def stream_state(self, value: str) -> None:
        self.activity_state.stream_state = value

    @property
    def total_frames(self) -> int:
        return self.activity_state.total_frames

    @property
    def accepted_frames(self) -> int:
        return self.activity_state.accepted_frames

    @property
    def rejected_frames(self) -> int:
        return self.activity_state.rejected_frames

    @property
    def active_streak(self) -> int:
        return self.activity_state.active_streak

    @property
    def start_streak(self) -> int:
        return self.activity_state.start_streak

    @start_streak.setter
    def start_streak(self, value: int) -> None:
        self.activity_state.start_streak = value

    @property
    def no_input_streak(self) -> int:
        return self.activity_state.no_input_streak

    @property
    def last_onset_frame(self) -> int | None:
        return self.activity_state.last_onset_frame

    @last_onset_frame.setter
    def last_onset_frame(self, value: int | None) -> None:
        self.activity_state.last_onset_frame = value

    @property
    def last_audio_active(self) -> bool:
        return self.activity_state.last_audio_active

    @last_audio_active.setter
    def last_audio_active(self, value: bool) -> None:
        self.activity_state.last_audio_active = value

    @property
    def _calibrated_rms_gate(self) -> float:
        return self.calibrator.calibrated_rms_gate

    @_calibrated_rms_gate.setter
    def _calibrated_rms_gate(self, value: float) -> None:
        self.calibrator.calibrated_rms_gate = value

    @property
    def _calibrated_peak_gate(self) -> float:
        return self.calibrator.calibrated_peak_gate

    @_calibrated_peak_gate.setter
    def _calibrated_peak_gate(self, value: float) -> None:
        self.calibrator.calibrated_peak_gate = value

    @property
    def _calibrated_flux_gate(self) -> float:
        return self.calibrator.calibrated_flux_gate

    @_calibrated_flux_gate.setter
    def _calibrated_flux_gate(self, value: float) -> None:
        self.calibrator.calibrated_flux_gate = value

    @property
    def _noise_rms_values(self) -> list[float]:
        return self.calibrator.noise_rms_values

    @property
    def _noise_peak_values(self) -> list[float]:
        return self.calibrator.noise_peak_values

    def _set_last_features(self, features: AudioFrameFeatures) -> None:
        self.last_rms = features.rms
        self.last_peak = features.peak
        self.last_tonal_signal = features.tonal_signal
        self.last_spectral_flatness = features.spectral_flatness
        self.last_peak_prominence = features.peak_prominence
        self.last_spectral_flux = features.spectral_flux
        self.last_onset_signal = features.onset_signal
        self.last_frame_class = features.frame_class

    def _last_features(
        self, rms: float | None = None, peak: float | None = None
    ) -> AudioFrameFeatures:
        return AudioFrameFeatures(
            rms=self.last_rms if rms is None else rms,
            peak=self.last_peak if peak is None else peak,
            tonal_signal=self.last_tonal_signal,
            spectral_flatness=self.last_spectral_flatness,
            peak_prominence=self.last_peak_prominence,
            spectral_flux=self.last_spectral_flux,
            onset_signal=self.last_onset_signal,
            frame_class=self.last_frame_class,
        )

    def _has_start_signal(self, rms: float, peak: float) -> bool:
        return self._start_signal_result(rms, peak)[0]

    def _start_signal_result(self, rms: float, peak: float) -> tuple[bool, str]:
        effective_rms_gate, effective_peak_gate = self._effective_start_gates()
        decision = self.audio_gate.start_signal(
            self._last_features(rms, peak),
            effective_rms_gate=effective_rms_gate,
            effective_peak_gate=effective_peak_gate,
        )
        return decision.active, decision.reason

    def _has_runtime_activity(self, rms: float, peak: float) -> bool:
        return self._runtime_activity_result(rms, peak)[0]

    def _runtime_activity_result(self, rms: float, peak: float) -> tuple[bool, str]:
        in_keepalive_window = self.activity_state.has_recent_music_activity(
            self.session_keepalive_frames,
        )
        decision = self.audio_gate.runtime_activity(
            self._last_features(rms, peak),
            calibrated_rms_gate=self._calibrated_rms_gate,
            calibrated_peak_gate=self._calibrated_peak_gate,
            total_frames=self.total_frames,
            last_onset_frame=self.last_onset_frame,
            in_keepalive_window=in_keepalive_window,
        )
        if decision.activity_marker == "onset":
            self.activity_state.mark_onset()
        elif decision.activity_marker == "music":
            self.activity_state.mark_music_activity()
        return decision.active, decision.reason

    def _score_start_feature(self, feature_vector) -> float | None:
        if self.start_feature_scorer is not None:
            return self.start_feature_scorer(feature_vector)
        if self.start_feature_validator is None:
            return None
        return 1.0 if self.start_feature_validator(feature_vector) else 0.0

    def _has_tonal_signal(self, audio_frame) -> bool:
        features = self.feature_extractor.extract(
            audio_frame,
            rms_gate=self.rms_gate,
            peak_gate=self.peak_gate,
            calibrated_flux_gate=self._calibrated_flux_gate,
        )
        self._set_last_features(features)
        return features.tonal_signal

    @property
    def activity_confidence_ceiling(self) -> float:
        return ActivityConfidenceEstimator.ceiling(
            last_audio_active=self.last_audio_active,
            started=self.started,
            no_input_streak=self.no_input_streak,
            no_input_frames=self.no_input_frames,
        )

    def _update_runtime_activity(
        self,
        rms: float,
        peak: float,
        runtime_active: bool | None = None,
    ) -> None:
        is_active = (
            runtime_active if runtime_active is not None else self._has_runtime_activity(rms, peak)
        )
        self.activity_state.update_runtime_activity(is_active)

    def _collect_noise_floor(self, rms: float, peak: float) -> None:
        self.calibrator.collect_noise_floor(self._last_features(rms, peak))

    def _maybe_update_runtime_noise_floor(self, rms: float, peak: float) -> None:
        self.calibrator.maybe_update_runtime_noise_floor(self._last_features(rms, peak))

    def _is_noise_floor_candidate(self, rms: float, peak: float) -> bool:
        return self.calibrator.is_noise_floor_candidate(rms, peak)

    def _effective_start_gates(self) -> tuple[float, float]:
        return (
            max(self.start_rms_gate, self._calibrated_rms_gate * 1.2),
            max(self.start_peak_gate, self._calibrated_peak_gate * 1.1),
        )

    def _record_warmup_signal(self, rms: float, peak: float) -> None:
        self._warmup_rms_values.append(rms)
        self._warmup_peak_values.append(peak)

    @property
    def environment_quality(self) -> EnvironmentQuality:
        if not self._warmup_rms_values or not self._warmup_peak_values:
            return "good"

        rms_p90 = float(self.np.percentile(self._warmup_rms_values, 90))
        peak_p90 = float(self.np.percentile(self._warmup_peak_values, 90))
        if rms_p90 >= self.start_rms_gate * 0.8 or peak_p90 >= self.start_peak_gate * 0.8:
            return "poor"
        if rms_p90 >= self.rms_gate * 0.75 or peak_p90 >= self.peak_gate * 0.75:
            return "noisy"
        return "good"

    def _refresh_calibrated_gates(self) -> None:
        self.calibrator.refresh_gates()

    def _update_noise_floor(self, rms: float, peak: float, alpha: float) -> None:
        self.calibrator.update_noise_floor(self._last_features(rms, peak), alpha=alpha)

    def _measure_signal(self, audio_frame) -> tuple[float, float]:
        return self.feature_extractor.measure_signal(audio_frame)

    def _latest_feature_vector(self, features):
        feature_array = self.np.asarray(features, dtype=float)
        if feature_array.size == 0:
            return None
        if feature_array.ndim == 1:
            return feature_array
        return feature_array[-1]

    @staticmethod
    def _feature_matrix(processor_output):
        if processor_output is None:
            return None
        if isinstance(processor_output, tuple):
            if not processor_output:
                return None
            return processor_output[0]
        return processor_output

    def _log_diagnostics(self, decision: str, rms: float, peak: float) -> None:
        log_audio_gate_diagnostic(self, decision, rms, peak)


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
        reference_features = BrowserAudioStreamAdapter._feature_matrix(
            self._processor((score_audio, 0.0))
        )
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
        beat_velocity = self._beat_velocity(
            beat_delta=beat_delta,
            timestamp_ms=timestamp_ms,
            previous_timestamp_ms=previous_timestamp_ms,
        )
        continuity_state = self._continuity_state(beat_delta)
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
            "continuity_state": continuity_state,
            "beat_velocity": beat_velocity,
        }

    def _start_alignment(self) -> AlignmentUpdate:
        """Anchor the UI to the first played note once its feature is confirmed."""
        return self._alignment_from_beat(self._score_start_beat)

    def _with_current_audio_state(self, alignment: AlignmentUpdate) -> AlignmentUpdate:
        audio_confidence = self._stream.activity_confidence_ceiling
        feature_confidence = self._feature_confidence_for_beat(alignment["beat_position"])
        alignment_confidence = min(alignment["alignment_confidence"], feature_confidence)
        continuity_confidence = alignment["continuity_confidence"]
        alignment_state = self._alignment_state(
            raw_alignment_confidence=alignment["alignment_confidence"],
            feature_confidence=feature_confidence,
        )
        continuity_state = alignment.get("continuity_state") or self._continuity_state(
            alignment.get("beat_delta"),
        )
        validation_confidence = self._validation_confidence_ceiling(
            alignment_state=alignment_state,
            continuity_state=continuity_state,
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
            "alignment_state": alignment_state,
            "continuity_state": continuity_state,
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

    @staticmethod
    def _alignment_state(
        *,
        raw_alignment_confidence: float,
        feature_confidence: float,
    ) -> str:
        if feature_confidence < 0.35:
            return "feature_mismatch"
        if feature_confidence < 0.7:
            return "weak_feature_match"
        if raw_alignment_confidence < 0.65:
            return "weak_path"
        return "matched"

    @staticmethod
    def _continuity_state(beat_delta: float | None) -> str:
        if beat_delta is None:
            return "initial"
        if beat_delta < -0.5:
            return "rollback"
        if beat_delta < -0.1:
            return "minor_rollback"
        if beat_delta > 8.0:
            return "large_jump"
        if beat_delta > 4.0:
            return "jump"
        return "stable"

    @staticmethod
    def _validation_confidence_ceiling(
        *,
        alignment_state: str,
        continuity_state: str,
    ) -> float:
        if alignment_state == "feature_mismatch":
            return 0.0
        if alignment_state in {"weak_feature_match", "weak_path"}:
            return 0.5
        if continuity_state in {"rollback", "large_jump"}:
            return 0.3
        if continuity_state in {"minor_rollback", "jump"}:
            return 0.5
        return 1.0

    @staticmethod
    def _beat_velocity(
        *,
        beat_delta: float | None,
        timestamp_ms: int,
        previous_timestamp_ms: int | None,
    ) -> float | None:
        if beat_delta is None or previous_timestamp_ms is None:
            return None
        elapsed_seconds = (timestamp_ms - previous_timestamp_ms) / 1000
        if elapsed_seconds <= 0:
            return None
        return round(beat_delta / elapsed_seconds, 3)

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
