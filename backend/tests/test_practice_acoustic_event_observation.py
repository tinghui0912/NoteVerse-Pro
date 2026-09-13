from __future__ import annotations

from pathlib import Path
import wave

import numpy as np

from app.processing.engines.practice_alignment.acoustic_event_observation import (
    AcousticEventObservationProfile,
    AcousticEventObserver,
    AcousticPitchCandidate,
)
from app.processing.engines.practice_alignment.expected_event_evaluator import (
    EvaluatorEvidence,
    ExpectedEventEvaluator,
)
from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    ExpectedPracticeNote,
    ExpectedPracticeStrikeTarget,
)


def expected_group(*pitches: str) -> ExpectedPracticeGroup:
    expected_notes = tuple(
        ExpectedPracticeNote(
            expected_note_id=f"event-1:n{index}",
            event_id="event-1",
            pitch=pitch,
            render_note_id=f"n{index}",
            measure_numbers=("1",),
        )
        for index, pitch in enumerate(pitches, start=1)
    )
    strike_targets = tuple(
        ExpectedPracticeStrikeTarget(
            strike_id=f"entry-1:strike:{pitch}",
            pitch=pitch,
            expected_notes=tuple(note for note in expected_notes if note.pitch == pitch),
            event_ids=("event-1",),
            render_note_ids=tuple(
                note.render_note_id for note in expected_notes if note.pitch == pitch
            ),
            measure_numbers=("1",),
        )
        for pitch in dict.fromkeys(pitches)
    )
    return ExpectedPracticeGroup(
        group_id="entry-1",
        onset_beat=4.0,
        event_ids=("event-1",),
        expected_notes=expected_notes,
        strike_targets=strike_targets,
        render_note_ids=tuple(note.render_note_id for note in expected_notes),
        pitches=pitches,
        measure_numbers=("1",),
        staff_ids=("1",),
        voice_ids=("1",),
    )


def evaluate(expected: ExpectedPracticeGroup, candidates: tuple[AcousticPitchCandidate, ...]):
    observation = AcousticEventObserver().observe_candidates(candidates, onset_beat=expected.onset_beat)
    return ExpectedEventEvaluator().evaluate(expected, EvaluatorEvidence.from_audio(observation))


def test_acoustic_observer_produces_high_confidence_single_note_match() -> None:
    evaluation = evaluate(expected_group("C4"), (AcousticPitchCandidate("C4", 0.93),))

    assert evaluation.result == "MATCH"
    assert evaluation.matched_pitches == ("C4",)
    assert evaluation.confidence == 0.93


def test_acoustic_observer_preserves_wrong_single_note_as_mismatch() -> None:
    evaluation = evaluate(expected_group("C4"), (AcousticPitchCandidate("D4", 0.91),))

    assert evaluation.result == "MISMATCH"
    assert evaluation.extra_pitches == ("D4",)


def test_acoustic_observer_treats_low_confidence_note_as_uncertain() -> None:
    evaluation = evaluate(expected_group("C4"), (AcousticPitchCandidate("C4", 0.62),))

    assert evaluation.result == "UNCERTAIN"
    assert evaluation.missing_pitches == ("C4",)
    assert evaluation.extra_pitches == ()


def test_acoustic_observer_supports_simple_high_confidence_chord_match() -> None:
    evaluation = evaluate(
        expected_group("C4", "E4", "G4"),
        (
            AcousticPitchCandidate("C4", 0.94),
            AcousticPitchCandidate("E4", 0.92),
            AcousticPitchCandidate("G4", 0.90),
        ),
    )

    assert evaluation.result == "MATCH"
    assert evaluation.matched_pitches == ("C4", "E4", "G4")


def test_acoustic_observer_allows_partial_chord_without_extra_pitches() -> None:
    evaluation = evaluate(
        expected_group("C4", "E4", "G4"),
        (
            AcousticPitchCandidate("C4", 0.94),
            AcousticPitchCandidate("G4", 0.90),
        ),
    )

    assert evaluation.result == "PARTIAL"
    assert evaluation.missing_pitches == ("E4",)
    assert evaluation.extra_pitches == ()


def test_acoustic_observer_rejects_octave_ambiguous_input_as_uncertain() -> None:
    evaluation = evaluate(
        expected_group("C4"),
        (
            AcousticPitchCandidate("C4", 0.94),
            AcousticPitchCandidate("C5", 0.70),
        ),
    )

    assert evaluation.result == "UNCERTAIN"


def test_acoustic_observer_rejects_complex_noisy_pitch_sets_as_uncertain() -> None:
    evaluation = evaluate(
        expected_group("C4", "E4", "G4"),
        (
            AcousticPitchCandidate("C4", 0.94),
            AcousticPitchCandidate("D4", 0.92),
            AcousticPitchCandidate("E4", 0.91),
            AcousticPitchCandidate("F#4", 0.90),
            AcousticPitchCandidate("G4", 0.89),
        ),
    )

    assert evaluation.result == "UNCERTAIN"


def test_acoustic_observer_can_convert_frequency_candidates() -> None:
    observation = AcousticEventObserver().observe_frequencies((261.625565, 329.627557, 391.995436))
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group("C4", "E4", "G4"),
        EvaluatorEvidence.from_audio(observation),
    )

    assert observation.observed_pitches == ("C4", "E4", "G4")
    assert evaluation.result == "MATCH"


def test_acoustic_observer_can_convert_mono_pcm_single_note() -> None:
    samples = _sine_frame(261.625565)
    observation = AcousticEventObserver().observe_mono_pcm(samples, sample_rate=16000, np_module=np)
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group("C4"),
        EvaluatorEvidence.from_audio(observation),
    )

    assert observation.observed_pitches == ("C4",)
    assert evaluation.result == "MATCH"


def test_acoustic_observer_can_convert_mono_pcm_simple_chord() -> None:
    samples = (
        _sine_frame(261.625565)
        + _sine_frame(329.627557)
        + _sine_frame(391.995436)
    ) / 3.0

    observer = AcousticEventObserver(
        AcousticEventObservationProfile(max_frequency_candidates=6)
    )

    observation = observer.observe_mono_pcm(
        samples,
        sample_rate=16000,
        np_module=np,
    )
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group("C4", "E4", "G4"),
        EvaluatorEvidence.from_audio(observation),
    )

    assert observation.observed_pitches == ("C4", "E4", "G4")
    assert evaluation.result == "MATCH"


def test_acoustic_observer_treats_quiet_pcm_as_uncertain() -> None:
    observation = AcousticEventObserver().observe_mono_pcm(
        np.zeros(8000, dtype=np.float32),
        sample_rate=16000,
        np_module=np,
    )
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group("C4"),
        EvaluatorEvidence.from_audio(observation),
    )

    assert observation.observed_pitches == ()
    assert evaluation.result == "UNCERTAIN"


def test_acoustic_observer_can_use_real_recording_pitch_estimate() -> None:
    frequency_hz = _dominant_frequency(
        Path("tests/fixtures/practice_audio/public_samples/piano_uiowa_mf_c4_16k.wav")
    )
    observation = AcousticEventObserver().observe_frequencies((frequency_hz,))
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group("C4"),
        EvaluatorEvidence.from_audio(observation),
    )

    assert observation.observed_pitches == ("C4",)
    assert evaluation.result == "MATCH"


def test_acoustic_observer_keeps_real_single_note_sample_monophonic() -> None:
    samples, sample_rate = _read_fixture_wav(
        Path("tests/fixtures/practice_audio/public_samples/piano_uiowa_mf_c4_16k.wav")
    )

    observation = AcousticEventObserver().observe_mono_pcm(
        samples,
        sample_rate=sample_rate,
        np_module=np,
    )

    assert observation.observed_pitches == ("C4",)


def _dominant_frequency(path: Path) -> float:
    samples, sample_rate = _read_fixture_wav(path)
    frame = _loudest_half_second(samples, sample_rate)
    spectrum = np.abs(np.fft.rfft(frame))
    frequencies = np.fft.rfftfreq(frame.size, 1 / sample_rate)
    low_index = int(np.searchsorted(frequencies, 80.0))
    high_index = int(np.searchsorted(frequencies, 1200.0))
    dominant_index = low_index + int(np.argmax(spectrum[low_index:high_index]))
    return float(frequencies[dominant_index])


def _read_fixture_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as recording:
        sample_rate = recording.getframerate()
        channel_count = recording.getnchannels()
        audio = recording.readframes(recording.getnframes())

    samples = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
    if channel_count > 1:
        samples = samples.reshape(-1, channel_count).mean(axis=1)
    return samples, sample_rate


def _loudest_half_second(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    frame_size = int(sample_rate * 0.5)
    hop_size = int(sample_rate * 0.05)
    starts = range(0, max(1, samples.size - frame_size), hop_size)
    frame_start = max(starts, key=lambda start: float(np.sqrt(np.mean(samples[start : start + frame_size] ** 2))))
    return samples[frame_start : frame_start + frame_size] * np.hanning(frame_size)


def _sine_frame(frequency_hz: float) -> np.ndarray:
    sample_rate = 16000
    t = np.arange(int(sample_rate * 0.5), dtype=np.float32) / sample_rate
    return (0.25 * np.sin(2 * np.pi * frequency_hz * t)).astype(np.float32)
