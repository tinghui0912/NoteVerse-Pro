from __future__ import annotations

import numpy as np

from app.processing.engines.practice_alignment.expected_event_evaluator import (
    EvaluatorEvidence,
    ExpectedEventEvaluator,
)
from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    ExpectedPracticeNote,
    ExpectedPracticeStrikeTarget,
)
from app.processing.engines.practice_alignment.target_conditioned_acoustic_observation import (
    TargetConditionedPianoObserver,
)


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
        pitches=tuple(dict.fromkeys(pitches)),
        measure_numbers=("1",),
        staff_ids=("1",),
        voice_ids=("1",),
    )


def test_target_conditioned_observer_detects_expected_synthetic_chord() -> None:
    observer = TargetConditionedPianoObserver()
    group = expected_group("C4", "E4", "G4")
    observation = observer.observe_expected_group(
        _mix(_sine(261.625565), _sine(329.627557), _sine(391.995436)),
        expected_group=group,
        sample_rate=SAMPLE_RATE,
        np_module=np,
        onset_beat=group.onset_beat,
    )

    assert observer.descriptor.provider_id == "target-conditioned-dsp-v1"
    assert observer.descriptor.benchmark_only is True
    assert observation.observed_pitches == ("C4", "E4", "G4")
    evaluation = ExpectedEventEvaluator().evaluate(
        group,
        EvaluatorEvidence.from_audio(observation.to_audio_observation()),
    )
    assert evaluation.result == "MATCH"


def test_target_conditioned_observer_reports_partial_missing_expected_pitch() -> None:
    group = expected_group("C4", "E4", "G4")
    observation = TargetConditionedPianoObserver().observe_expected_group(
        _mix(_sine(261.625565), _sine(391.995436)),
        expected_group=group,
        sample_rate=SAMPLE_RATE,
        np_module=np,
        onset_beat=group.onset_beat,
    )

    assert observation.observed_pitches == ("C4", "G4")
    evaluation = ExpectedEventEvaluator().evaluate(
        group,
        EvaluatorEvidence.from_audio(observation.to_audio_observation()),
    )
    assert evaluation.result == "PARTIAL"
    assert evaluation.missing_pitches == ("E4",)


def test_target_conditioned_observer_is_quiet_for_silence() -> None:
    group = expected_group("C4")
    observation = TargetConditionedPianoObserver().observe_expected_group(
        np.zeros(int(SAMPLE_RATE * 0.5), dtype=np.float32),
        expected_group=group,
        sample_rate=SAMPLE_RATE,
        np_module=np,
        onset_beat=group.onset_beat,
    )

    assert observation.observed_pitches == ()
    assert observation.confidence == 0.0


def _sine(frequency_hz: float) -> np.ndarray:
    t = np.arange(int(SAMPLE_RATE * 0.5), dtype=np.float32) / SAMPLE_RATE
    return (0.25 * np.sin(2 * np.pi * frequency_hz * t)).astype(np.float32)


def _mix(*signals: np.ndarray) -> np.ndarray:
    mixed = np.sum(np.stack(signals), axis=0)
    peak = float(np.max(np.abs(mixed)))
    if peak <= 0.0:
        return mixed.astype(np.float32)
    return (0.25 * mixed / peak).astype(np.float32)
