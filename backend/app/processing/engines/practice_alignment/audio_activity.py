from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


AudioFrameClass = Literal["silence", "transient", "tonal", "uncertain"]  # Alignment input class.

SHORT_FRAME_MIN_SAMPLES = 8
SPECTRUM_EPSILON = 1e-12
SILENCE_RMS_RATIO = 0.1
SILENCE_PEAK_RATIO = 0.1
ONSET_RMS_RATIO = 0.2
ONSET_PEAK_RATIO = 0.1
NOISE_FLOOR_CANDIDATE_RATIO = 0.75
INITIAL_NOISE_ALPHA = 0.15
RUNTIME_NOISE_ALPHA = 0.02
FLUX_FLOOR_DIVISOR = 4.0
FLUX_GATE_MULTIPLIER = 3.0
MUSICAL_START_FLATNESS_GATE = 0.58
MUSICAL_START_PROMINENCE_MULTIPLIER = 1.5
MUSICAL_START_MIN_PROMINENCE = 12.0
TONAL_FOCUSED_START_FLATNESS_GATE = 0.30
FOCUSED_START_PROMINENCE_MULTIPLIER = 3.0
FOCUSED_START_MIN_PROMINENCE = 24.0
HOLD_TONAL_DECAY_CONFIDENCE = 0.35
HOLD_UNCERTAIN_INPUT_CONFIDENCE = 0.2
JUST_INACTIVE_CONFIDENCE = 0.45
NO_INPUT_GRACE_CONFIDENCE = 0.35


@dataclass
class AudioFrameFeatures:
    rms: float
    peak: float
    tonal_signal: bool
    spectral_flatness: float
    peak_prominence: float
    spectral_flux: float
    onset_signal: bool
    frame_class: AudioFrameClass = "uncertain"


class FrameClassifier:
    """Classify one audio frame using already extracted signal features."""

    def classify(
        self,
        features: AudioFrameFeatures,
        *,
        rms_gate: float,
        peak_gate: float,
        calibrated_flux_gate: float,
    ) -> AudioFrameClass:
        if (
            features.rms < rms_gate * SILENCE_RMS_RATIO
            and features.peak < peak_gate * SILENCE_PEAK_RATIO
        ):
            return "silence"
        if features.tonal_signal:
            return "tonal"
        if features.onset_signal or features.spectral_flux >= calibrated_flux_gate:
            return "transient"
        return "uncertain"


class AudioFeatureExtractor:
    """Extract frame-local audio features without owning practice session state."""

    def __init__(
        self,
        np,
        tonal_gate_enabled: bool,
        max_spectral_flatness: float,
        min_peak_prominence: float,
    ) -> None:
        self.np = np
        self.tonal_gate_enabled = tonal_gate_enabled
        self.max_spectral_flatness = max_spectral_flatness
        self.min_peak_prominence = min_peak_prominence
        self._previous_flux_spectrum = None
        self.frame_classifier = FrameClassifier()

    def extract(
        self,
        audio_frame,
        rms_gate: float,
        peak_gate: float,
        calibrated_flux_gate: float,
    ) -> AudioFrameFeatures:
        rms, peak = self.measure_signal(audio_frame) if audio_frame.size else (0.0, 0.0)

        if not self.tonal_gate_enabled:
            return AudioFrameFeatures(
                rms=rms,
                peak=peak,
                tonal_signal=True,
                spectral_flatness=0.0,
                peak_prominence=self.min_peak_prominence,
                spectral_flux=0.0,
                onset_signal=False,
                frame_class="tonal",
            )

        if audio_frame.size < SHORT_FRAME_MIN_SAMPLES:
            return self._with_frame_class(
                self._empty_features(rms, peak),
                rms_gate=rms_gate,
                peak_gate=peak_gate,
                calibrated_flux_gate=calibrated_flux_gate,
            )

        window = self.np.hanning(audio_frame.size)
        spectrum = self.np.abs(self.np.fft.rfft(audio_frame * window))[1:]
        if spectrum.size == 0:
            return self._with_frame_class(
                self._empty_features(rms, peak),
                rms_gate=rms_gate,
                peak_gate=peak_gate,
                calibrated_flux_gate=calibrated_flux_gate,
            )

        mean_magnitude = float(self.np.mean(spectrum)) + SPECTRUM_EPSILON
        geometric_mean = float(
            self.np.exp(self.np.mean(self.np.log(spectrum + SPECTRUM_EPSILON)))
        )
        spectral_flatness = geometric_mean / mean_magnitude
        peak_prominence = float(self.np.max(spectrum)) / mean_magnitude
        spectral_flux = self._spectral_flux(spectrum, mean_magnitude)
        tonal_signal = (
            spectral_flatness <= self.max_spectral_flatness
            and peak_prominence >= self.min_peak_prominence
        )
        musical_start_spectrum = tonal_signal or (
            spectral_flatness <= MUSICAL_START_FLATNESS_GATE
            and peak_prominence
            >= max(
                self.min_peak_prominence * MUSICAL_START_PROMINENCE_MULTIPLIER,
                MUSICAL_START_MIN_PROMINENCE,
            )
        )
        has_onset_energy = rms >= rms_gate * ONSET_RMS_RATIO or peak >= peak_gate * ONSET_PEAK_RATIO
        onset_signal = (
            spectral_flux >= calibrated_flux_gate and has_onset_energy and musical_start_spectrum
        )

        return self._with_frame_class(
            AudioFrameFeatures(
                rms=rms,
                peak=peak,
                tonal_signal=tonal_signal,
                spectral_flatness=spectral_flatness,
                peak_prominence=peak_prominence,
                spectral_flux=spectral_flux,
                onset_signal=onset_signal,
            ),
            rms_gate=rms_gate,
            peak_gate=peak_gate,
            calibrated_flux_gate=calibrated_flux_gate,
        )

    def _with_frame_class(
        self,
        features: AudioFrameFeatures,
        *,
        rms_gate: float,
        peak_gate: float,
        calibrated_flux_gate: float,
    ) -> AudioFrameFeatures:
        features.frame_class = self.frame_classifier.classify(
            features,
            rms_gate=rms_gate,
            peak_gate=peak_gate,
            calibrated_flux_gate=calibrated_flux_gate,
        )
        return features

    def measure_signal(self, audio_frame) -> tuple[float, float]:
        rms = float(self.np.sqrt(self.np.mean(self.np.square(audio_frame))))
        peak = float(self.np.max(self.np.abs(audio_frame)))
        return rms, peak

    def _empty_features(self, rms: float, peak: float) -> AudioFrameFeatures:
        return AudioFrameFeatures(
            rms=rms,
            peak=peak,
            tonal_signal=False,
            spectral_flatness=1.0,
            peak_prominence=0.0,
            spectral_flux=0.0,
            onset_signal=False,
        )

    def _spectral_flux(self, spectrum, mean_magnitude: float) -> float:
        normalized = spectrum / max(mean_magnitude, SPECTRUM_EPSILON)
        if self._previous_flux_spectrum is None:
            self._previous_flux_spectrum = normalized
            return 0.0

        previous = self._previous_flux_spectrum
        if previous.shape != normalized.shape:
            min_size = min(previous.size, normalized.size)
            previous = previous[:min_size]
            normalized = normalized[:min_size]

        previous_max = previous.copy()
        if previous.size > 1:
            previous_max = self.np.maximum(previous_max, self.np.roll(previous, 1))
            previous_max = self.np.maximum(previous_max, self.np.roll(previous, -1))
            previous_max[0] = max(previous[0], previous[1])
            previous_max[-1] = max(previous[-1], previous[-2])

        positive_change = self.np.maximum(normalized - previous_max, 0.0)
        self._previous_flux_spectrum = normalized
        return float(self.np.mean(positive_change))


class AdaptiveNoiseCalibrator:
    """Own adaptive RMS, peak, and flux gates."""

    def __init__(
        self,
        np,
        rms_gate: float,
        peak_gate: float,
        onset_flux_gate: float,
        rms_noise_multiplier: float,
        peak_noise_multiplier: float,
    ) -> None:
        self.np = np
        self.rms_gate = rms_gate
        self.peak_gate = peak_gate
        self.onset_flux_gate = onset_flux_gate
        self.rms_noise_multiplier = rms_noise_multiplier
        self.peak_noise_multiplier = peak_noise_multiplier
        self.noise_rms_values: list[float] = []
        self.noise_peak_values: list[float] = []
        self.noise_rms_floor = max(rms_gate / max(rms_noise_multiplier, 1.0), 1e-6)
        self.noise_peak_floor = max(peak_gate / max(peak_noise_multiplier, 1.0), 1e-6)
        self.flux_floor = max(onset_flux_gate / FLUX_FLOOR_DIVISOR, 1e-6)
        self.calibrated_rms_gate = rms_gate
        self.calibrated_peak_gate = peak_gate
        self.calibrated_flux_gate = onset_flux_gate

    def collect_noise_floor(self, features: AudioFrameFeatures) -> bool:
        if features.tonal_signal or features.onset_signal:
            return False
        if not self.is_noise_floor_candidate(features.rms, features.peak):
            return False

        self.noise_rms_values.append(features.rms)
        self.noise_peak_values.append(features.peak)
        self.update_noise_floor(features, alpha=INITIAL_NOISE_ALPHA)
        self.refresh_gates()
        return True

    def maybe_update_runtime_noise_floor(self, features: AudioFrameFeatures) -> None:
        if (
            features.tonal_signal
            or features.onset_signal
            or not self.is_noise_floor_candidate(features.rms, features.peak)
        ):
            return

        self.update_noise_floor(features, alpha=RUNTIME_NOISE_ALPHA)
        self.refresh_gates()

    def is_noise_floor_candidate(self, rms: float, peak: float) -> bool:
        return (
            rms <= self.rms_gate * NOISE_FLOOR_CANDIDATE_RATIO
            and peak <= self.peak_gate * NOISE_FLOOR_CANDIDATE_RATIO
        )

    def refresh_gates(self) -> None:
        self.calibrated_rms_gate = max(
            self.rms_gate,
            self.noise_rms_floor * self.rms_noise_multiplier,
        )
        self.calibrated_peak_gate = max(
            self.peak_gate,
            self.noise_peak_floor * self.peak_noise_multiplier,
        )
        self.calibrated_flux_gate = max(
            self.onset_flux_gate,
            self.flux_floor * FLUX_GATE_MULTIPLIER,
        )

    def update_noise_floor(self, features: AudioFrameFeatures, alpha: float) -> None:
        if self.noise_rms_values:
            rms_floor = float(self.np.percentile(self.noise_rms_values, 90))
            self.noise_rms_floor = max(self.noise_rms_floor, rms_floor)
        self.noise_rms_floor = alpha * max(features.rms, 1e-6) + (1 - alpha) * self.noise_rms_floor

        if self.noise_peak_values:
            peak_floor = float(self.np.percentile(self.noise_peak_values, 90))
            self.noise_peak_floor = max(self.noise_peak_floor, peak_floor)
        self.noise_peak_floor = (
            alpha * max(features.peak, 1e-6) + (1 - alpha) * self.noise_peak_floor
        )

        if not features.onset_signal:
            self.flux_floor = (
                alpha * max(features.spectral_flux, 1e-6) + (1 - alpha) * self.flux_floor
            )


@dataclass(frozen=True)
class AudioGateConfig:
    rms_gate: float
    peak_gate: float
    start_rms_gate: float
    start_peak_gate: float
    min_peak_prominence: float
    onset_hold_frames: int
    start_rms_ratio: float = 0.5
    start_rms_fallback_ratio: float = 0.75
    start_peak_ratio: float = 0.55
    start_peak_fallback_ratio: float = 0.75
    runtime_rms_ratio: float = 0.45
    runtime_peak_ratio: float = 0.30
    decay_rms_ratio: float = 0.2
    decay_peak_ratio: float = 0.1


@dataclass(frozen=True)
class StartSignalDecision:
    active: bool
    reason: str


@dataclass(frozen=True)
class RuntimeActivityDecision:
    active: bool
    reason: str
    activity_marker: Literal["onset", "music", None] = None


class PracticeAudioGate:
    """Decide whether extracted audio features can start or sustain following."""

    def __init__(self, config: AudioGateConfig) -> None:
        self.config = config

    def start_signal(
        self,
        features: AudioFrameFeatures,
        *,
        effective_rms_gate: float,
        effective_peak_gate: float,
    ) -> StartSignalDecision:
        prominence_gate = max(
            self.config.min_peak_prominence * FOCUSED_START_PROMINENCE_MULTIPLIER,
            FOCUSED_START_MIN_PROMINENCE,
        )
        focused_musical_candidate = (
            features.spectral_flatness <= TONAL_FOCUSED_START_FLATNESS_GATE
            and features.peak_prominence >= prominence_gate
        )
        has_candidate_energy = (
            features.rms
            >= min(
                self.config.start_rms_gate * self.config.start_rms_ratio,
                self.config.rms_gate * self.config.start_rms_fallback_ratio,
            )
            and features.peak >= min(
                self.config.start_peak_gate * self.config.start_peak_ratio,
                self.config.peak_gate * self.config.start_peak_fallback_ratio,
            )
        )
        strong_start = (
            features.rms >= effective_rms_gate
            and features.peak >= effective_peak_gate
            and (features.tonal_signal or focused_musical_candidate)
            and features.peak_prominence >= prominence_gate
        )
        if strong_start:
            return StartSignalDecision(
                True,
                "strong_start" if features.tonal_signal else "focused_musical_start",
            )

        if not features.tonal_signal and focused_musical_candidate and has_candidate_energy:
            return StartSignalDecision(True, "focused_musical_start_candidate")

        if not features.tonal_signal:
            return StartSignalDecision(False, "not_tonal")
        if features.peak_prominence < prominence_gate:
            return StartSignalDecision(False, "low_prominence")
        if features.rms < min(
            self.config.start_rms_gate * self.config.start_rms_ratio,
            self.config.rms_gate * self.config.start_rms_fallback_ratio,
        ):
            return StartSignalDecision(False, "low_start_rms")
        if features.peak < min(
            self.config.start_peak_gate * self.config.start_peak_ratio,
            self.config.peak_gate * self.config.start_peak_fallback_ratio,
        ):
            return StartSignalDecision(False, "low_start_peak")
        return StartSignalDecision(False, "start_gate_not_met")

    def runtime_activity(
        self,
        features: AudioFrameFeatures,
        *,
        calibrated_rms_gate: float,
        calibrated_peak_gate: float,
        total_frames: int,
        last_onset_frame: int | None,
        in_keepalive_window: bool,
    ) -> RuntimeActivityDecision:
        runtime_rms_gate = calibrated_rms_gate * self.config.runtime_rms_ratio
        runtime_peak_gate = calibrated_peak_gate * self.config.runtime_peak_ratio
        in_onset_hold = (
            last_onset_frame is not None
            and total_frames - last_onset_frame <= self.config.onset_hold_frames
        )
        has_runtime_energy = features.rms >= runtime_rms_gate or features.peak >= runtime_peak_gate
        has_decay_energy = (
            features.rms >= self.config.rms_gate * self.config.decay_rms_ratio
            or features.peak >= self.config.peak_gate * self.config.decay_peak_ratio
        )
        trusted_onset = features.onset_signal and features.tonal_signal
        current_musical_activity = features.tonal_signal and has_runtime_energy
        if trusted_onset:
            return RuntimeActivityDecision(True, "trusted_onset", "onset")
        if current_musical_activity:
            return RuntimeActivityDecision(True, "tonal_runtime_energy", "music")
        if in_keepalive_window and features.tonal_signal and (in_onset_hold or has_decay_energy):
            return RuntimeActivityDecision(True, "session_decay_window")
        if in_keepalive_window:
            return RuntimeActivityDecision(True, "session_keepalive_window")
        if not features.tonal_signal:
            return RuntimeActivityDecision(False, "not_tonal")
        if not has_runtime_energy and not has_decay_energy:
            return RuntimeActivityDecision(False, "low_runtime_energy")
        return RuntimeActivityDecision(False, "runtime_gate_not_met")


@dataclass(frozen=True)
class OltwQueueDecision:
    should_queue: bool
    reason: str
    input_weight: float
    confidence_ceiling: float


class OltwInputPolicy:
    """Decide whether an extracted feature frame should be queued for OLTW."""

    def decide(
        self,
        *,
        started: bool,
        has_previous_chunk: bool,
        runtime_active: bool,
        frame_class: AudioFrameClass,
    ) -> OltwQueueDecision:
        if not started:
            return OltwQueueDecision(False, "not_started", 0.0, 0.0)
        if not has_previous_chunk:
            return OltwQueueDecision(False, "priming_context", 0.0, 0.0)
        if not runtime_active:
            if frame_class == "tonal":
                return OltwQueueDecision(
                    False,
                    "hold_tonal_decay",
                    0.0,
                    HOLD_TONAL_DECAY_CONFIDENCE,
                )
            if frame_class == "uncertain":
                return OltwQueueDecision(
                    False,
                    "hold_uncertain_input",
                    0.0,
                    HOLD_UNCERTAIN_INPUT_CONFIDENCE,
                )
            return OltwQueueDecision(False, f"hold_{frame_class}", 0.0, 0.0)
        if frame_class != "tonal":
            return OltwQueueDecision(
                False,
                f"hold_active_{frame_class}",
                0.0,
                HOLD_UNCERTAIN_INPUT_CONFIDENCE,
            )
        return OltwQueueDecision(True, "queued_tonal", 1.0, 1.0)


class ActivityConfidenceEstimator:
    """Convert activity state into a confidence ceiling."""

    @staticmethod
    def ceiling(
        *,
        last_audio_active: bool,
        started: bool,
        no_input_streak: int,
        no_input_frames: int,
    ) -> float:
        if last_audio_active:
            return 1.0
        if not started:
            return 0.0
        if no_input_streak == 0:
            return JUST_INACTIVE_CONFIDENCE
        if no_input_streak < no_input_frames:
            return NO_INPUT_GRACE_CONFIDENCE
        return 0.0


class PracticeActivityStateMachine:
    """Own practice stream state and activity counters."""

    def __init__(self, calibration_sample_count: int, no_input_frames: int) -> None:
        self.calibration_sample_count = max(calibration_sample_count, 0)
        self.calibration_samples = 0
        self.no_input_frames = max(no_input_frames, 1)
        self.armed = True
        self.started = False
        self.performance_active = False
        self.stream_state = "armed"
        self.total_frames = 0
        self.accepted_frames = 0
        self.rejected_frames = 0
        self.active_streak = 0
        self.start_streak = 0
        self.no_input_streak = 0
        self.last_onset_frame: int | None = None
        self.last_music_activity_frame: int | None = None
        self.last_audio_active = False

    @property
    def ready_to_start(self) -> bool:
        return self.started

    def begin_frame(self) -> None:
        self.total_frames += 1
        self.last_audio_active = False

    def record_calibration_samples(self, sample_count: int) -> None:
        self.calibration_samples += max(sample_count, 0)

    @property
    def calibration_complete(self) -> bool:
        return self.calibration_samples >= self.calibration_sample_count

    def reject(self, state: str | None = None) -> None:
        if state is not None:
            self.stream_state = state
        self.rejected_frames += 1
        self.active_streak = 0

    def accept(self) -> None:
        self.accepted_frames += 1
        self.active_streak += 1

    def mark_start_signal(self, onset_signal: bool) -> None:
        self.start_streak += 1
        if onset_signal:
            self.last_onset_frame = self.total_frames

    def clear_start_signal(self) -> None:
        self.start_streak = 0

    def mark_started(self, onset_signal: bool) -> None:
        self.started = True
        self.performance_active = True
        self.stream_state = "following"
        self.no_input_streak = 0
        self.last_music_activity_frame = self.total_frames
        if onset_signal:
            self.last_onset_frame = self.total_frames

    def mark_onset(self) -> None:
        self.last_onset_frame = self.total_frames
        self.last_music_activity_frame = self.total_frames

    def mark_music_activity(self) -> None:
        self.last_music_activity_frame = self.total_frames

    def has_recent_music_activity(self, window_frames: int) -> bool:
        return (
            self.last_music_activity_frame is not None
            and self.total_frames - self.last_music_activity_frame <= window_frames
        )

    def update_runtime_activity(self, is_active: bool) -> None:
        if is_active:
            self.no_input_streak = 0
            self.performance_active = True
            self.stream_state = "following"
            return

        self.no_input_streak += 1
        if self.no_input_streak >= self.no_input_frames:
            self.performance_active = False
            self.stream_state = "lost"
        else:
            self.stream_state = "holding_decay"
