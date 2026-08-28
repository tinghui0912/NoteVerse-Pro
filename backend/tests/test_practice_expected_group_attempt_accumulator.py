from __future__ import annotations

import numpy as np

from app.processing.engines.practice_alignment.acoustic_event_observation import AcousticEventObserver
from app.processing.engines.practice_alignment.expected_event_evaluator import (
    EvaluatorEvidence,
    ExpectedEventEvaluator,
)
from app.processing.engines.practice_alignment.expected_group_attempt_accumulator import (
    ExpectedGroupAttemptAccumulator,
)
from app.processing.engines.practice_alignment.score_timeline import ExpectedPracticeGroup


def expected_group(*pitches: str) -> ExpectedPracticeGroup:
    return ExpectedPracticeGroup(
        group_id="entry-1",
        onset_beat=4.0,
        event_ids=("event-1",),
        render_note_ids=("n1",),
        pitches=pitches,
        measure_numbers=("1",),
        staff_ids=("1",),
        voice_ids=("1",),
    )


def make_accumulator() -> ExpectedGroupAttemptAccumulator:
    return ExpectedGroupAttemptAccumulator(
        observer=AcousticEventObserver(),
        sample_rate=16000,
        np_module=np,
        window_samples=8000,
        collection_frames=3,
        release_frame_threshold=2,
    )


def test_attempt_accumulator_collects_rolled_chord_before_finalizing() -> None:
    accumulator = make_accumulator()

    first = accumulator.observe_frame(
        _sine_frame(261.625565),
        candidate_signal=True,
        onset_beat=4.0,
        expected_group_id="entry-1",
        timestamp_ms=100,
    )
    second = accumulator.observe_frame(
        _sine_frame(329.627557),
        candidate_signal=True,
        onset_beat=4.0,
        expected_group_id="entry-1",
        timestamp_ms=115,
    )
    final = accumulator.observe_frame(
        _sine_frame(391.995436),
        candidate_signal=True,
        onset_beat=4.0,
        expected_group_id="entry-1",
        timestamp_ms=130,
    )

    assert first is None
    assert second is None
    assert final is not None
    assert final.observed_pitches == ("C4", "E4", "G4")
    assert accumulator.last_resolved_attempt is not None
    assert accumulator.last_resolved_attempt.attempt_sequence == 1
    assert accumulator.last_resolved_attempt.expected_group_id == "entry-1"
    assert accumulator.last_resolved_attempt.started_at_ms == 100
    assert accumulator.last_resolved_attempt.resolved_at_ms == 130
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group("C4", "E4", "G4"),
        EvaluatorEvidence.from_audio(final),
    )
    assert evaluation.result == "MATCH"


def test_attempt_accumulator_emits_no_repeated_observation_until_release() -> None:
    accumulator = make_accumulator()

    frames = [_sine_frame(261.625565) for _ in range(6)]
    observations = [
        accumulator.observe_frame(frame, candidate_signal=True, onset_beat=4.0)
        for frame in frames
    ]

    assert sum(observation is not None for observation in observations) == 1

    silence = np.zeros(8000, dtype=np.float32)
    assert accumulator.observe_frame(silence, candidate_signal=False, onset_beat=4.0) is None
    assert accumulator.open is True
    assert accumulator.observe_frame(silence, candidate_signal=False, onset_beat=4.0) is None
    assert accumulator.open is False


def test_attempt_accumulator_reset_preserves_session_sequence() -> None:
    accumulator = make_accumulator()

    for timestamp_ms in (10, 20, 30):
        accumulator.observe_frame(
            _sine_frame(261.625565),
            candidate_signal=True,
            onset_beat=4.0,
            expected_group_id="entry-1",
            timestamp_ms=timestamp_ms,
        )

    assert accumulator.last_resolved_attempt is not None
    assert accumulator.last_resolved_attempt.attempt_sequence == 1

    accumulator.reset()
    for timestamp_ms in (100, 110, 120):
        accumulator.observe_frame(
            _sine_frame(329.627557),
            candidate_signal=True,
            onset_beat=5.0,
            expected_group_id="entry-2",
            timestamp_ms=timestamp_ms,
        )

    assert accumulator.last_resolved_attempt is not None
    assert accumulator.last_resolved_attempt.attempt_sequence == 2
    assert accumulator.last_resolved_attempt.expected_group_id == "entry-2"


def test_attempt_accumulator_finalizes_pending_before_collection_window_completes() -> None:
    accumulator = make_accumulator()

    assert (
        accumulator.observe_frame(
            _sine_frame(261.625565),
            candidate_signal=True,
            onset_beat=4.0,
            expected_group_id="entry-1",
            timestamp_ms=100,
        )
        is None
    )

    observation = accumulator.finalize_pending(onset_beat=4.0, timestamp_ms=125)

    assert observation is not None
    assert observation.observed_pitches == ("C4",)
    assert accumulator.last_resolved_attempt is not None
    assert accumulator.last_resolved_attempt.attempt_sequence == 1
    assert accumulator.last_resolved_attempt.resolved_at_ms == 125


def _sine_frame(frequency_hz: float) -> np.ndarray:
    sample_rate = 16000
    t = np.arange(int(sample_rate * 0.5), dtype=np.float32) / sample_rate
    return (0.25 * np.sin(2 * np.pi * frequency_hz * t)).astype(np.float32)
