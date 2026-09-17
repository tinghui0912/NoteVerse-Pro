from __future__ import annotations

from app.processing.engines.practice_alignment.expected_event_evaluator import (
    AudioObservation,
    EvaluatorEvidence,
    ExpectedEventEvaluator,
    MidiObservation,
    PracticeObservation,
    PracticeProgressionDecision,
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


def test_expected_event_evaluator_matches_exact_group() -> None:
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group("C4", "E4", "G4"),
        EvaluatorEvidence.from_midi(MidiObservation(("C4", "E4", "G4"))),
    )

    assert evaluation.result == "MATCH"
    assert evaluation.matched_pitches == ("C4", "E4", "G4")
    assert evaluation.missing_pitches == ()
    assert evaluation.extra_pitches == ()


def test_expected_event_evaluator_marks_partial_chord_without_wrong_notes() -> None:
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group("C4", "E4", "G4"),
        EvaluatorEvidence.from_midi(MidiObservation(("C4", "G4"))),
    )

    assert evaluation.result == "PARTIAL"
    assert evaluation.matched_pitches == ("C4", "G4")
    assert evaluation.missing_pitches == ("E4",)
    assert evaluation.extra_pitches == ()


def test_expected_event_evaluator_marks_wrong_or_extra_pitches_as_mismatch() -> None:
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group("C4", "E4", "G4"),
        EvaluatorEvidence.from_midi(MidiObservation(("C4", "F4", "G4"))),
    )

    assert evaluation.result == "MISMATCH"
    assert evaluation.matched_pitches == ("C4", "G4")
    assert evaluation.missing_pitches == ("E4",)
    assert evaluation.extra_pitches == ("F4",)


def test_expected_event_evaluator_is_uncertain_for_low_confidence_audio() -> None:
    evaluation = ExpectedEventEvaluator().evaluate(
        expected_group("C4"),
        EvaluatorEvidence.from_audio(AudioObservation(("C4",), confidence=0.42)),
    )

    assert evaluation.result == "UNCERTAIN"
    assert evaluation.matched_pitches == ()
    assert evaluation.missing_pitches == ("C4",)
    assert evaluation.extra_pitches == ()


def test_runtime_observation_and_progression_contract_are_explicit() -> None:
    evaluator = ExpectedEventEvaluator()
    evidence = EvaluatorEvidence.from_midi(MidiObservation(("C4",)))
    observation = PracticeObservation(expected_group_id="entry-1", evidence=evidence)
    evaluation = evaluator.evaluate(expected_group("C4"), observation.evidence)
    decision = PracticeProgressionDecision(
        expected_group_id=observation.expected_group_id,
        action="ADVANCE",
        evaluation=evaluation,
        policy_profile_version="wait-for-note-v1",
    )

    assert decision.action == "ADVANCE"
    assert decision.evaluation.evaluator_version == "expected-event-v1"
