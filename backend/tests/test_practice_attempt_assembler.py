from __future__ import annotations

from uuid import UUID

from app.processing.engines.practice_alignment.attempt_assembler import (
    PracticeAttemptAssembler,
    ResolvedPracticeAttemptBuffer,
    attach_attempt_outcome,
    display_anchor_for_expected_group,
    resolved_attempt_from_outcome,
)
from app.processing.engines.practice_alignment.expected_event_evaluator import PracticeEventEvaluation
from app.processing.engines.practice_alignment.follow_policy import AlignmentDecision
from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    ExpectedPracticeNote,
    ExpectedPracticeStrikeTarget,
)


def expected_group() -> ExpectedPracticeGroup:
    expected_note = ExpectedPracticeNote(
        expected_note_id="event-1:n1",
        event_id="event-1",
        pitch="C4",
        render_note_id="n1",
        measure_numbers=("1",),
    )
    return ExpectedPracticeGroup(
        group_id="entry-1",
        onset_beat=4.0,
        event_ids=("event-1",),
        expected_notes=(expected_note,),
        strike_targets=(
            ExpectedPracticeStrikeTarget(
                strike_id="entry-1:strike:C4",
                pitch="C4",
                expected_notes=(expected_note,),
                event_ids=("event-1",),
                render_note_ids=("n1",),
                measure_numbers=("1",),
            ),
        ),
        render_note_ids=("n1",),
        pitches=("C4",),
        measure_numbers=("1",),
        staff_ids=("1",),
        voice_ids=("1",),
    )


def test_attempt_assembler_resolves_evaluation_with_stable_identity() -> None:
    assembler = PracticeAttemptAssembler(policy_profile_version="wait-for-note-v1")
    assembler.begin(expected_group_id="entry-1", timestamp_ms=100)

    evaluation = PracticeEventEvaluation(
        expected_group_id="entry-1",
        result="PARTIAL",
        matched_pitches=("C4",),
        missing_pitches=("E4",),
        extra_pitches=(),
        confidence=0.8,
        evaluator_version="expected-event-v1",
    )

    pending = assembler.pending(evaluation)
    resolved = assembler.resolve(evaluation, timestamp_ms=180)

    assert pending is not None
    assert resolved is not None
    assert pending.snapshot.attempt_id == resolved.snapshot.attempt_id
    assert resolved.snapshot.attempt_sequence == 1
    assert resolved.snapshot.started_at_ms == 100
    assert resolved.snapshot.resolved_at_ms == 180
    assert resolved.evaluation.result == "PARTIAL"


def test_attach_attempt_outcome_adds_resolved_decision_metadata() -> None:
    assembler = PracticeAttemptAssembler()
    assembler.begin(expected_group_id="entry-1", timestamp_ms=100)
    evaluation = PracticeEventEvaluation(
        expected_group_id="entry-1",
        result="MATCH",
        matched_pitches=("C4",),
        missing_pitches=(),
        extra_pitches=(),
        confidence=1.0,
        evaluator_version="expected-event-v1",
    )
    outcome = assembler.resolve(evaluation, timestamp_ms=120)
    decision: AlignmentDecision = {
        "action": "advance",
        "reason": "stable_match",
        "experience_state": "following",
        "display_anchor": {"beat": 4.0, "group_id": "entry-1"},
        "confidence_summary": {
            "visual": 1.0,
            "alignment": 1.0,
            "audio": 1.0,
            "continuity": 1.0,
            "validation": 1.0,
            "input_policy": 1.0,
        },
    }

    attach_attempt_outcome(decision, outcome)

    assert outcome is not None
    assert decision["attempt_state"] == "resolved"
    assert decision["attempt_id"] == outcome.snapshot.attempt_id
    UUID(str(decision["attempt_id"]))
    assert decision["attempt_sequence"] == 1
    assert decision["attempt_started_at_ms"] == 100
    assert decision["attempt_resolved_at_ms"] == 120
    assert decision["evaluator_version"] == "expected-event-v1"
    assert decision["policy_profile_version"] == "wait-for-note-v1"
    assert decision["evaluation_result"] == "MATCH"
    assert decision["matched_pitches"] == ["C4"]
    assert decision["missing_pitches"] == []
    assert decision["extra_pitches"] == []


def test_resolved_attempt_uses_expected_group_anchor_not_ui_decision_anchor() -> None:
    assembler = PracticeAttemptAssembler()
    assembler.begin(expected_group_id="entry-1", timestamp_ms=100)
    evaluation = PracticeEventEvaluation(
        expected_group_id="entry-1",
        result="MATCH",
        matched_pitches=("C4",),
        missing_pitches=(),
        extra_pitches=(),
        confidence=1.0,
        evaluator_version="expected-event-v1",
    )
    outcome = assembler.resolve(evaluation, timestamp_ms=120)
    expected_anchor = display_anchor_for_expected_group(
        expected_group()
    )

    resolved_attempt = resolved_attempt_from_outcome(
        outcome=outcome,
        action="advance",
        resolution_reason="stable_match",
        experience_state="following",
        display_anchor=expected_anchor,
        measure_numbers=("1",),
        confidence=1.0,
        timestamp_ms=120,
    )

    assert resolved_attempt is not None
    assert resolved_attempt.display_anchor["group_id"] == "entry-1"
    assert "measure_numbers" not in resolved_attempt.display_anchor
    assert resolved_attempt.measure_numbers == ("1",)
    assert resolved_attempt.beat_position == 4.0


def test_resolved_attempt_buffer_collects_only_resolved_expected_group_attempts() -> None:
    assembler = PracticeAttemptAssembler()
    buffer = ResolvedPracticeAttemptBuffer()
    group = expected_group()
    evaluation = PracticeEventEvaluation(
        expected_group_id="entry-1",
        result="MATCH",
        matched_pitches=("C4",),
        missing_pitches=(),
        extra_pitches=(),
        confidence=1.0,
        evaluator_version="expected-event-v1",
    )
    assembler.begin(expected_group_id="entry-1", timestamp_ms=100)
    pending = assembler.pending(evaluation)
    resolved = assembler.resolve(evaluation, timestamp_ms=120)

    buffer.append_for_expected_group(
        outcome=pending,
        action="wait",
        resolution_reason="partial_match",
        experience_state="partially_matched",
        expected_group=group,
        update_confidence=0.5,
        update_timestamp_ms=100,
    )
    buffer.append_for_expected_group(
        outcome=resolved,
        action="advance",
        resolution_reason="stable_match",
        experience_state="following",
        expected_group=group,
        update_confidence=1.0,
        update_timestamp_ms=120,
        validation_confidence=1.0,
        input_policy_confidence=1.0,
    )

    attempts = buffer.drain()
    assert len(attempts) == 1
    assert attempts[0].display_anchor["group_id"] == "entry-1"
    assert attempts[0].beat_position == 4.0
    assert attempts[0].validation_confidence == 1.0
    assert attempts[0].input_policy_confidence == 1.0
    assert buffer.drain() == []
