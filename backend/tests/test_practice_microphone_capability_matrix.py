from __future__ import annotations

from pathlib import Path
import wave

import numpy as np

from app.processing.engines.practice_alignment.acoustic_event_observation import AcousticEventObserver
from app.processing.engines.practice_alignment.expected_event_evaluator import (
    EvaluatorEvidence,
    ExpectedEventEvaluator,
)
from app.processing.engines.practice_alignment.expected_group_attempt_accumulator import (
    ExpectedGroupAttemptAccumulator,
)
from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    ExpectedPracticeNote,
    ExpectedPracticeStrikeTarget,
)


FIXTURE_ROOT = Path("tests/fixtures/practice_audio")
SAMPLE_RATE = 16000


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


def evaluate_pcm(samples: np.ndarray, *expected_pitches: str):
    observation = AcousticEventObserver().observe_mono_pcm(
        samples,
        sample_rate=SAMPLE_RATE,
        np_module=np,
    )
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group(*expected_pitches),
        EvaluatorEvidence.from_audio(observation),
    )
    return observation, evaluation


def test_microphone_capability_matrix_real_single_notes_match() -> None:
    cases = (
        ("public_samples/piano_uiowa_mf_c4_16k.wav", "C4"),
        ("public_samples/piano_uiowa_mf_c5_16k.wav", "C5"),
    )

    for fixture, expected_pitch in cases:
        samples = load_wav(FIXTURE_ROOT / fixture)
        observation, evaluation = evaluate_pcm(loudest_half_second(samples), expected_pitch)

        assert observation.observed_pitches == (expected_pitch,)
        assert evaluation.result == "MATCH"


def test_microphone_capability_matrix_accumulator_handles_synthetic_rolled_chord() -> None:
    accumulator = ExpectedGroupAttemptAccumulator(
        observer=AcousticEventObserver(),
        sample_rate=SAMPLE_RATE,
        np_module=np,
        window_samples=8000,
        collection_frames=3,
        release_frame_threshold=2,
    )

    observations = [
        accumulator.observe_frame(sine_frame(261.625565), candidate_signal=True, onset_beat=4.0),
        accumulator.observe_frame(sine_frame(329.627557), candidate_signal=True, onset_beat=4.0),
        accumulator.observe_frame(sine_frame(391.995436), candidate_signal=True, onset_beat=4.0),
    ]

    final = observations[-1]
    assert observations[:2] == [None, None]
    assert final is not None
    assert final.observed_pitches == ("C4", "E4", "G4")
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group("C4", "E4", "G4"),
        EvaluatorEvidence.from_audio(final),
    )
    assert evaluation.result == "MATCH"


def test_microphone_capability_matrix_repeated_same_pitch_requires_release() -> None:
    accumulator = ExpectedGroupAttemptAccumulator(
        observer=AcousticEventObserver(),
        sample_rate=SAMPLE_RATE,
        np_module=np,
        window_samples=8000,
        collection_frames=3,
        release_frame_threshold=2,
    )
    c4 = sine_frame(261.625565)
    silence = np.zeros_like(c4)

    first_attempt = [
        accumulator.observe_frame(c4, candidate_signal=True, onset_beat=4.0),
        accumulator.observe_frame(c4, candidate_signal=True, onset_beat=4.0),
        accumulator.observe_frame(c4, candidate_signal=True, onset_beat=4.0),
    ]
    held_frames = [
        accumulator.observe_frame(c4, candidate_signal=True, onset_beat=4.0),
        accumulator.observe_frame(c4, candidate_signal=True, onset_beat=4.0),
    ]
    release_frames = [
        accumulator.observe_frame(silence, candidate_signal=False, onset_beat=4.0),
        accumulator.observe_frame(silence, candidate_signal=False, onset_beat=4.0),
    ]
    second_attempt = [
        accumulator.observe_frame(c4, candidate_signal=True, onset_beat=4.0),
        accumulator.observe_frame(c4, candidate_signal=True, onset_beat=4.0),
        accumulator.observe_frame(c4, candidate_signal=True, onset_beat=4.0),
    ]

    assert [observation is not None for observation in first_attempt] == [False, False, True]
    assert held_frames == [None, None]
    assert release_frames == [None, None]
    assert [observation is not None for observation in second_attempt] == [False, False, True]
    assert first_attempt[-1] is not None
    assert first_attempt[-1].observed_pitches == ("C4",)
    assert second_attempt[-1] is not None
    assert second_attempt[-1].observed_pitches == ("C4",)


def test_microphone_capability_matrix_simultaneous_chord_is_not_strictly_supported() -> None:
    chord = normalize_audio(
        sine_frame(261.625565) + sine_frame(329.627557) + sine_frame(391.995436)
    )

    observation, evaluation = evaluate_pcm(chord, "C4", "E4", "G4")

    assert len(observation.observed_pitches) <= 1
    assert evaluation.result != "MATCH"


def test_microphone_capability_matrix_octave_mixture_is_not_strictly_supported() -> None:
    c4 = loudest_half_second(load_wav(FIXTURE_ROOT / "public_samples/piano_uiowa_mf_c4_16k.wav"))
    c5 = loudest_half_second(load_wav(FIXTURE_ROOT / "public_samples/piano_uiowa_mf_c5_16k.wav"))
    mixture = normalize_audio(c4 + c5)

    observation, evaluation = evaluate_pcm(mixture, "C4", "C5")

    assert len(observation.observed_pitches) <= 1
    assert evaluation.result != "MATCH"


def load_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as recording:
        sample_rate = recording.getframerate()
        channel_count = recording.getnchannels()
        audio = recording.readframes(recording.getnframes())

    assert sample_rate == SAMPLE_RATE
    samples = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
    if channel_count > 1:
        samples = samples.reshape(-1, channel_count).mean(axis=1)
    return samples


def loudest_half_second(samples: np.ndarray) -> np.ndarray:
    frame_size = int(SAMPLE_RATE * 0.5)
    hop_size = int(SAMPLE_RATE * 0.05)
    if samples.size <= frame_size:
        return np.pad(samples, (0, frame_size - samples.size))
    starts = range(0, samples.size - frame_size, hop_size)
    frame_start = max(
        starts,
        key=lambda start: float(np.sqrt(np.mean(samples[start : start + frame_size] ** 2))),
    )
    return samples[frame_start : frame_start + frame_size]


def normalize_audio(samples: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(samples)))
    if peak <= 0:
        return samples.astype(np.float32)
    return (0.25 * samples / peak).astype(np.float32)


def sine_frame(frequency_hz: float) -> np.ndarray:
    t = np.arange(int(SAMPLE_RATE * 0.5), dtype=np.float32) / SAMPLE_RATE
    return (0.25 * np.sin(2 * np.pi * frequency_hz * t)).astype(np.float32)
