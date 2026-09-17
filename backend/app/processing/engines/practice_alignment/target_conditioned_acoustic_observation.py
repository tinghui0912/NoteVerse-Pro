"""Experimental score-conditioned acoustic evidence for expected practice targets."""

from __future__ import annotations

from dataclasses import dataclass
import re

from app.processing.engines.practice_alignment.expected_event_evaluator import AudioObservation
from app.processing.engines.practice_alignment.acoustic_evidence_provider import (
    AcousticEvidenceProviderDescriptor,
)
from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    ScoreBeat,
)


_PITCH_RE = re.compile(r"^([A-Ga-g](?:#|b)?)(-?\d+)$")
_PITCH_CLASS_INDEX = {
    "C": 0,
    "C#": 1,
    "D": 2,
    "D#": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "G": 7,
    "G#": 8,
    "A": 9,
    "A#": 10,
    "B": 11,
}
_FLAT_TO_SHARP = {
    "Bb": "A#",
    "Db": "C#",
    "Eb": "D#",
    "Gb": "F#",
    "Ab": "G#",
}


@dataclass(frozen=True)
class TargetConditionedObservationProfile:
    spectral_match_threshold: float = 0.45
    min_rms: float = 1e-4
    max_harmonic: int = 4
    harmonic_rolloff: float = 0.55
    pitch_band_cents: float = 35.0
    max_frequency_hz: float = 5000.0


@dataclass(frozen=True)
class ExpectedPitchActivation:
    pitch: str
    spectral_score: float
    confidence: float
    matched: bool


@dataclass(frozen=True)
class TargetConditionedObservation:
    expected_group_id: str
    onset_beat: ScoreBeat | None
    activations: tuple[ExpectedPitchActivation, ...]
    extra_observed_pitches: tuple[str, ...] = ()
    extra_confidence: float = 0.0

    @property
    def observed_pitches(self) -> tuple[str, ...]:
        matched_expected = tuple(
            activation.pitch for activation in self.activations if activation.matched
        )
        return tuple(dict.fromkeys((*matched_expected, *self.extra_observed_pitches)))

    @property
    def confidence(self) -> float:
        matched = tuple(activation.confidence for activation in self.activations if activation.matched)
        values = (*matched, self.extra_confidence) if self.extra_observed_pitches else matched
        return min(values, default=0.0)

    def to_audio_observation(self) -> AudioObservation:
        return AudioObservation(
            observed_pitches=self.observed_pitches,
            confidence=self.confidence,
            onset_beat=self.onset_beat,
        )


@dataclass(frozen=True)
class TargetConditionedPianoObserver:
    """Estimates activation only for the current expected piano strike targets."""

    descriptor: AcousticEvidenceProviderDescriptor = AcousticEvidenceProviderDescriptor(
        provider_id="target-conditioned-dsp-v1",
        benchmark_only=True,
        output_semantics="expected-pitch spectral activation from handcrafted DSP",
    )
    profile: TargetConditionedObservationProfile = TargetConditionedObservationProfile()

    def observe_expected_group(
        self,
        samples,
        *,
        expected_group: ExpectedPracticeGroup,
        sample_rate: int,
        np_module,
        onset_beat: ScoreBeat | None = None,
        window_start_seconds: float | None = None,
        window_end_seconds: float | None = None,
    ) -> TargetConditionedObservation:
        expected_pitches = tuple(strike.pitch for strike in expected_group.strike_targets)
        if not expected_pitches:
            return TargetConditionedObservation(
                expected_group_id=expected_group.group_id,
                onset_beat=onset_beat,
                activations=(),
            )

        spectrum_context = _spectrum_context(
            samples,
            sample_rate=sample_rate,
            np_module=np_module,
            min_rms=self.profile.min_rms,
            max_frequency_hz=self.profile.max_frequency_hz,
        )
        if spectrum_context is None:
            activations = tuple(
                ExpectedPitchActivation(
                    pitch=pitch,
                    spectral_score=0.0,
                    confidence=0.0,
                    matched=False,
                )
                for pitch in expected_pitches
            )
            return TargetConditionedObservation(
                expected_group_id=expected_group.group_id,
                onset_beat=onset_beat,
                activations=activations,
            )

        raw_scores = {
            pitch: _pitch_activation_score(
                spectrum_context,
                pitch,
                profile=self.profile,
                np_module=np_module,
            )
            for pitch in expected_pitches
        }
        strongest_expected_score = max(raw_scores.values(), default=0.0)
        activations = tuple(
            _activation_from_score(
                pitch,
                score,
                strongest_expected_score=strongest_expected_score,
                threshold=self.profile.spectral_match_threshold,
            )
            for pitch, score in raw_scores.items()
        )
        return TargetConditionedObservation(
            expected_group_id=expected_group.group_id,
            onset_beat=onset_beat,
            activations=activations,
        )


@dataclass(frozen=True)
class _SpectrumContext:
    spectrum: object
    frequencies: object
    global_peak: float
    sample_rate: int


def _spectrum_context(
    samples,
    *,
    sample_rate: int,
    np_module,
    min_rms: float,
    max_frequency_hz: float,
) -> _SpectrumContext | None:
    if sample_rate <= 0:
        return None
    audio = np_module.asarray(samples, dtype=np_module.float32)
    if audio.size < 256 or not np_module.isfinite(audio).all():
        return None

    audio = audio - float(np_module.mean(audio))
    rms = float(np_module.sqrt(np_module.mean(np_module.square(audio))))
    if rms <= min_rms:
        return None

    windowed = audio * np_module.hanning(audio.size)
    fft_size = max(4096, 1 << int(np_module.ceil(np_module.log2(max(windowed.size * 4, 1)))))
    spectrum = np_module.abs(np_module.fft.rfft(windowed, n=fft_size))
    frequencies = np_module.fft.rfftfreq(fft_size, 1.0 / sample_rate)
    low_index = int(np_module.searchsorted(frequencies, 80.0))
    high_index = int(np_module.searchsorted(frequencies, max_frequency_hz))
    if high_index <= low_index:
        return None
    global_peak = float(np_module.max(spectrum[low_index:high_index]))
    if global_peak <= 1e-9:
        return None
    return _SpectrumContext(
        spectrum=spectrum,
        frequencies=frequencies,
        global_peak=global_peak,
        sample_rate=sample_rate,
    )


def _pitch_activation_score(
    context: _SpectrumContext,
    pitch: str,
    *,
    profile: TargetConditionedObservationProfile,
    np_module,
) -> float:
    fundamental = _pitch_frequency_hz(pitch)
    if fundamental is None:
        return 0.0

    score = 0.0
    weight_total = 0.0
    for harmonic in range(1, profile.max_harmonic + 1):
        center_hz = fundamental * harmonic
        if center_hz > profile.max_frequency_hz:
            break
        weight = profile.harmonic_rolloff ** (harmonic - 1)
        score += weight * _band_peak_ratio(
            context,
            center_hz,
            cents=profile.pitch_band_cents,
            np_module=np_module,
        )
        weight_total += weight
    if weight_total <= 0.0:
        return 0.0
    return max(0.0, min(1.0, score / weight_total))


def _band_peak_ratio(
    context: _SpectrumContext,
    center_hz: float,
    *,
    cents: float,
    np_module,
) -> float:
    lower = center_hz / (2.0 ** (cents / 1200.0))
    upper = center_hz * (2.0 ** (cents / 1200.0))
    low_index = int(np_module.searchsorted(context.frequencies, lower))
    high_index = int(np_module.searchsorted(context.frequencies, upper))
    if high_index <= low_index:
        return 0.0
    band_peak = float(np_module.max(context.spectrum[low_index : high_index + 1]))
    return max(0.0, min(1.0, band_peak / context.global_peak))


def _activation_from_score(
    pitch: str,
    score: float,
    *,
    strongest_expected_score: float,
    threshold: float,
) -> ExpectedPitchActivation:
    normalized_score = 0.0 if strongest_expected_score <= 0.0 else score / strongest_expected_score
    confidence = max(0.0, min(1.0, normalized_score))
    return ExpectedPitchActivation(
        pitch=pitch,
        spectral_score=round(score, 4),
        confidence=round(confidence, 4),
        matched=confidence >= threshold,
    )


def _pitch_frequency_hz(pitch: str) -> float | None:
    midi_number = _midi_number(pitch)
    if midi_number is None:
        return None
    return 440.0 * (2.0 ** ((midi_number - 69) / 12.0))


def _midi_number(pitch: str) -> int | None:
    match = _PITCH_RE.match(pitch.strip())
    if match is None:
        return None
    pitch_class = match.group(1)
    pitch_class = pitch_class[0].upper() + pitch_class[1:]
    pitch_class = _FLAT_TO_SHARP.get(pitch_class, pitch_class)
    if pitch_class not in _PITCH_CLASS_INDEX:
        return None
    octave = int(match.group(2))
    return (octave + 1) * 12 + _PITCH_CLASS_INDEX[pitch_class]
