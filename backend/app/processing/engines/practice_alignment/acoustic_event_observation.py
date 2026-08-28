"""Conservative acoustic pitch evidence for practice correctness evaluation."""

from __future__ import annotations

from dataclasses import dataclass
import math
import re
from collections.abc import Iterable

from app.processing.engines.practice_alignment.expected_event_evaluator import AudioObservation
from app.processing.engines.practice_alignment.score_timeline import ScoreBeat


_PITCH_RE = re.compile(r"^([A-Ga-g](?:#|b)?)(-?\d+)$")
_FLAT_TO_SHARP = {
    "Bb": "A#",
    "Db": "C#",
    "Eb": "D#",
    "Gb": "F#",
    "Ab": "G#",
}
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
_MIDI_PITCH_CLASSES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


@dataclass(frozen=True)
class AcousticPitchCandidate:
    pitch: str
    confidence: float

    @classmethod
    def from_frequency(
        cls,
        frequency_hz: float,
        *,
        tolerance_cents: float = 50.0,
    ) -> "AcousticPitchCandidate | None":
        if frequency_hz <= 0 or not math.isfinite(frequency_hz):
            return None

        midi_float = 69.0 + 12.0 * math.log2(frequency_hz / 440.0)
        midi_pitch = int(round(midi_float))
        pitch_frequency = 440.0 * (2.0 ** ((midi_pitch - 69.0) / 12.0))
        cents_error = abs(1200.0 * math.log2(frequency_hz / pitch_frequency))
        confidence = max(0.0, min(1.0, 1.0 - cents_error / tolerance_cents))
        return cls(pitch=_midi_pitch_name(midi_pitch), confidence=confidence)


@dataclass(frozen=True)
class AcousticEventObservationProfile:
    min_pitch_confidence: float = 0.80
    ambiguity_confidence: float = 0.65
    max_simple_chord_pitches: int = 4


@dataclass(frozen=True)
class AcousticEventObserver:
    profile: AcousticEventObservationProfile = AcousticEventObservationProfile()

    def observe_candidates(
        self,
        candidates: Iterable[AcousticPitchCandidate],
        *,
        onset_beat: ScoreBeat | None = None,
    ) -> AudioObservation:
        normalized_candidates = tuple(
            _normalize_candidate(candidate)
            for candidate in candidates
            if candidate.confidence >= self.profile.ambiguity_confidence
        )
        if any(candidate is None for candidate in normalized_candidates):
            return _uncertain_observation(onset_beat)

        ambiguity_candidates = tuple(candidate for candidate in normalized_candidates if candidate is not None)
        if _has_octave_ambiguity(ambiguity_candidates):
            return _uncertain_observation(onset_beat)

        selected = tuple(
            candidate
            for candidate in ambiguity_candidates
            if candidate.confidence >= self.profile.min_pitch_confidence
        )
        if not selected:
            return _uncertain_observation(onset_beat)

        pitches = _unique_ordered_pitches(selected)
        if len(pitches) > self.profile.max_simple_chord_pitches:
            return _uncertain_observation(onset_beat)

        confidence = min(candidate.confidence for candidate in selected if candidate.pitch in set(pitches))
        return AudioObservation(
            observed_pitches=pitches,
            confidence=confidence,
            onset_beat=onset_beat,
        )

    def observe_frequencies(
        self,
        frequencies_hz: Iterable[float],
        *,
        onset_beat: ScoreBeat | None = None,
    ) -> AudioObservation:
        candidates = tuple(
            candidate
            for frequency_hz in frequencies_hz
            if (candidate := AcousticPitchCandidate.from_frequency(frequency_hz)) is not None
        )
        return self.observe_candidates(candidates, onset_beat=onset_beat)

    def observe_mono_pcm(
        self,
        samples,
        *,
        sample_rate: int,
        np_module,
        onset_beat: ScoreBeat | None = None,
    ) -> AudioObservation:
        frequency_hz = _dominant_frequency(samples, sample_rate=sample_rate, np_module=np_module)
        if frequency_hz is None:
            return _uncertain_observation(onset_beat)
        return self.observe_frequencies((frequency_hz,), onset_beat=onset_beat)


def _normalize_candidate(candidate: AcousticPitchCandidate) -> AcousticPitchCandidate | None:
    pitch = _normalize_pitch_name(candidate.pitch)
    if pitch is None or not math.isfinite(candidate.confidence):
        return None
    confidence = max(0.0, min(1.0, candidate.confidence))
    return AcousticPitchCandidate(pitch=pitch, confidence=confidence)


def _normalize_pitch_name(pitch: str) -> str | None:
    match = _PITCH_RE.match(pitch.strip())
    if match is None:
        return None

    root = match.group(1)
    root = root[0].upper() + root[1:]
    root = _FLAT_TO_SHARP.get(root, root)
    if root not in _PITCH_CLASS_INDEX:
        return None
    return f"{root}{int(match.group(2))}"


def _has_octave_ambiguity(candidates: tuple[AcousticPitchCandidate, ...]) -> bool:
    pitches_by_class: dict[str, set[str]] = {}
    for candidate in candidates:
        pitch_class = _pitch_class(candidate.pitch)
        if pitch_class is None:
            return True
        pitches_by_class.setdefault(pitch_class, set()).add(candidate.pitch)
    return any(len(pitches) > 1 for pitches in pitches_by_class.values())


def _pitch_class(pitch: str) -> str | None:
    normalized = _normalize_pitch_name(pitch)
    if normalized is None:
        return None
    return normalized.rstrip("-0123456789")


def _unique_ordered_pitches(candidates: tuple[AcousticPitchCandidate, ...]) -> tuple[str, ...]:
    ordered = sorted(candidates, key=lambda candidate: _midi_number(candidate.pitch))
    return tuple(dict.fromkeys(candidate.pitch for candidate in ordered))


def _midi_number(pitch: str) -> int:
    normalized = _normalize_pitch_name(pitch)
    if normalized is None:
        return -1
    pitch_class = normalized.rstrip("-0123456789")
    octave = int(normalized.removeprefix(pitch_class))
    return (octave + 1) * 12 + _PITCH_CLASS_INDEX[pitch_class]


def _midi_pitch_name(midi_pitch: int) -> str:
    octave = midi_pitch // 12 - 1
    return f"{_MIDI_PITCH_CLASSES[midi_pitch % 12]}{octave}"


def _uncertain_observation(onset_beat: ScoreBeat | None) -> AudioObservation:
    return AudioObservation(observed_pitches=(), confidence=0.0, onset_beat=onset_beat)


def _dominant_frequency(samples, *, sample_rate: int, np_module) -> float | None:
    if sample_rate <= 0:
        return None

    audio = np_module.asarray(samples, dtype=np_module.float32)
    if audio.size < 256 or not np_module.isfinite(audio).all():
        return None

    audio = audio - float(np_module.mean(audio))
    rms = float(np_module.sqrt(np_module.mean(np_module.square(audio))))
    if rms <= 1e-4:
        return None

    windowed = audio * np_module.hanning(audio.size)
    fft_size = max(4096, 1 << int(np_module.ceil(np_module.log2(max(windowed.size * 4, 1)))))
    spectrum = np_module.abs(np_module.fft.rfft(windowed, n=fft_size))
    frequencies = np_module.fft.rfftfreq(fft_size, 1.0 / sample_rate)
    low_index = int(np_module.searchsorted(frequencies, 80.0))
    high_index = int(np_module.searchsorted(frequencies, 1200.0))
    if high_index <= low_index:
        return None

    search_spectrum = spectrum[low_index:high_index]
    if search_spectrum.size == 0:
        return None

    peak_index = low_index + int(np_module.argmax(search_spectrum))
    peak_value = float(spectrum[peak_index])
    local_floor = float(np_module.median(search_spectrum))
    if peak_value <= max(local_floor * 8.0, 1e-6):
        return None

    refined_index = _parabolic_peak_index(spectrum, peak_index)
    frequency_hz = refined_index * sample_rate / fft_size
    if not math.isfinite(frequency_hz):
        return None
    return float(frequency_hz)


def _parabolic_peak_index(spectrum, peak_index: int) -> float:
    if peak_index <= 0 or peak_index >= len(spectrum) - 1:
        return float(peak_index)
    left = float(spectrum[peak_index - 1])
    center = float(spectrum[peak_index])
    right = float(spectrum[peak_index + 1])
    denominator = left - 2.0 * center + right
    if abs(denominator) <= 1e-12:
        return float(peak_index)
    offset = 0.5 * (left - right) / denominator
    return float(peak_index + max(-0.5, min(0.5, offset)))
