"""Browser PCM input adapter for live practice alignment."""

from __future__ import annotations

import time
from typing import Callable

from app.processing.engines.practice_alignment.audio_activity import (
    ActivityConfidenceEstimator,
    AdaptiveNoiseCalibrator,
    AudioFrameClass,
    AudioFrameFeatures,
    AudioFeatureExtractor,
    AudioGateConfig,
    OltwInputPolicy,
    PracticeActivityStateMachine,
    PracticeAudioGate,
)
from app.processing.engines.practice_alignment.audio_diagnostics import log_audio_gate_diagnostic
from app.processing.engines.practice_alignment.audio_features import feature_matrix, latest_feature_vector
from app.processing.engines.practice_alignment.contracts import InputHealth, InputLevel, InputNoise
from app.processing.engines.practice_alignment.stream_state import (
    STREAM_STATE_ARMED,
    STREAM_STATE_CALIBRATING,
)

HIGH_CONFIDENCE_START_FEATURE_MATCH = 0.98

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
        start_feature_window_frames: int | None = None,
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
        window_frames = start_feature_window_frames or self.min_active_frames + 1
        self.start_feature_window_frames = max(window_frames, self.min_active_frames)
        self._start_feature_candidates: list[tuple[int, float | None, str]] = []
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
        features = feature_matrix(self.processor((target_audio, feature_time)))
        if features is None:
            self.last_chunk = target_audio[-self.hop_length :]
            self.last_gate_reason = "feature_buffering"
            self.last_queue_decision = "feature_buffering"
            self._log_diagnostics("feature_buffering", rms, peak)
            return False
        self.last_feature_vector = latest_feature_vector(features, self.np)
        if not self.started and has_start_signal:
            self.last_start_feature_confidence = self._score_start_feature(
                self.last_feature_vector,
            )
            self._record_start_feature_candidate(self.last_start_feature_confidence)
        if not self.started and self._startup_feature_window_ready():
            self.last_start_feature_confidence = self._best_start_feature_confidence()
            if (
                self.last_start_feature_confidence is not None
                and not self._has_enough_start_feature_matches()
            ):
                self.activity_state.clear_start_signal()
                self._clear_start_feature_candidates()
                self._maybe_update_runtime_noise_floor(rms, peak)
                self.last_chunk = target_audio[-self.hop_length :]
                self.activity_state.reject(STREAM_STATE_ARMED)
                self.last_gate_reason = "start_feature_mismatch"
                self.last_queue_decision = "start_rejected"
                self._log_diagnostics("start_rejected", rms, peak)
                return False
            self._clear_start_feature_candidates()
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

    def _record_start_feature_candidate(self, confidence: float | None) -> None:
        self._start_feature_candidates.append(
            (self.total_frames, confidence, self.last_start_signal_reason)
        )
        self._prune_start_feature_candidates()

    def _prune_start_feature_candidates(self) -> None:
        first_allowed_frame = self.total_frames - self.start_feature_window_frames + 1
        self._start_feature_candidates = [
            candidate
            for candidate in self._start_feature_candidates
            if candidate[0] >= first_allowed_frame
        ]

    def _startup_feature_window_ready(self) -> bool:
        if self.start_feature_scorer is None and self.start_feature_validator is None:
            return self.start_streak >= self.min_active_frames
        self._prune_start_feature_candidates()
        if self._has_high_confidence_start_feature_match():
            return True
        return len(self._start_feature_candidates) >= self._required_start_feature_matches()

    def _best_start_feature_confidence(self) -> float | None:
        scored_candidates = [
            confidence
            for _frame, confidence, _reason in self._start_feature_candidates
            if confidence is not None
        ]
        if not scored_candidates:
            return None
        return max(scored_candidates)

    def _has_enough_start_feature_matches(self) -> bool:
        if self.last_start_feature_confidence is None:
            return True
        if self._has_high_confidence_start_feature_match():
            return True
        matched_candidates = [
            confidence
            for _frame, confidence, _reason in self._start_feature_candidates
            if confidence is not None and confidence >= 0.7
        ]
        return len(matched_candidates) >= self._required_start_feature_matches()

    def _required_start_feature_matches(self) -> int:
        return min(2, self.min_active_frames)

    def _has_high_confidence_start_feature_match(self) -> bool:
        return any(
            confidence is not None
            and confidence >= HIGH_CONFIDENCE_START_FEATURE_MATCH
            and reason.startswith("focused_musical_start")
            for _frame, confidence, reason in self._start_feature_candidates
        )

    def _clear_start_feature_candidates(self) -> None:
        self._start_feature_candidates.clear()

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
    def input_health(self) -> InputHealth:
        rms_p90, peak_p90 = self._warmup_percentiles()

        level: InputLevel = "good"
        if peak_p90 >= 0.98 or self.last_peak >= 0.98:
            level = "clipping"
        elif (
            self.armed
            and self.total_frames > self.warmup_frames
            and self.no_input_streak >= min(6, self.no_input_frames)
            and self.last_rms < self.rms_gate * 0.25
            and self.last_peak < self.peak_gate * 0.25
        ):
            level = "too_quiet"

        noise: InputNoise = "good"
        noise_rms = rms_p90
        noise_peak = peak_p90
        if self._current_frame_can_update_noise_health():
            noise_rms = max(noise_rms, self.last_rms)
            noise_peak = max(noise_peak, self.last_peak)

        if noise_rms >= self.start_rms_gate * 0.8 or noise_peak >= self.start_peak_gate * 0.8:
            noise = "high"
        elif noise_rms >= self.rms_gate * 0.75 or noise_peak >= self.peak_gate * 0.75:
            noise = "elevated"

        confidence = min(1.0, len(self._warmup_rms_values) / max(self.warmup_frames, 1))
        return {
            "available": True,
            "level": level,
            "noise": noise,
            "confidence": round(confidence, 3),
        }

    def _warmup_percentiles(self) -> tuple[float, float]:
        if not self._warmup_rms_values or not self._warmup_peak_values:
            return 0.0, 0.0
        return (
            float(self.np.percentile(self._warmup_rms_values, 90)),
            float(self.np.percentile(self._warmup_peak_values, 90)),
        )

    def _current_frame_can_update_noise_health(self) -> bool:
        return (
            self.armed
            and not self.last_tonal_signal
            and not self.last_onset_signal
            and self.last_frame_class != "tonal"
        )

    def _refresh_calibrated_gates(self) -> None:
        self.calibrator.refresh_gates()

    def _update_noise_floor(self, rms: float, peak: float, alpha: float) -> None:
        self.calibrator.update_noise_floor(self._last_features(rms, peak), alpha=alpha)

    def _measure_signal(self, audio_frame) -> tuple[float, float]:
        return self.feature_extractor.measure_signal(audio_frame)

    def _log_diagnostics(self, decision: str, rms: float, peak: float) -> None:
        log_audio_gate_diagnostic(self, decision, rms, peak)
