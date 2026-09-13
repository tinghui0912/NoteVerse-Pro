from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.db.models import PracticeInputSource
from app.db.models.practice import (
    PracticeEvaluationProfile,
    PracticeProgressionMode,
    PracticeRealtimeGuidance,
    PracticeSessionCompletionReason,
    PracticeSessionState,
)
from app.processing.engines.practice_alignment.score_timeline import (
    PracticeEntryGroup,
    PracticeScoreEvent,
    PracticeScoreTimeline,
)
from app.processing.performance.evidence import (
    PerformanceExpectedEventOutcome,
    PerformanceExpectedEventResult,
    PerformanceExpectedStrikeOutcome,
    PerformanceExpectedStrikeResult,
    PerformanceObservation,
    PerformanceObservationSource,
    PerformanceSummaryAccumulator,
)
from app.processing.performance.evaluator import PerformanceExpectedEventEvaluator
from app.processing.performance.timeline import PerformanceTimeline
from app.processing.reports.practice_session_summary import PracticeSessionSummaryBuilder
from tests.performance_timeline_fixtures import score_timeline


def test_performance_summary_accumulator_reports_conservative_coverage() -> None:
    accumulator = PerformanceSummaryAccumulator(
        completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
        input_source=PracticeInputSource.MICROPHONE,
        scope_kind="FULL_PIECE",
        active_duration_ms=1_000,
    )

    accumulator.add_observation(
        PerformanceObservation(
            source=PerformanceObservationSource.MICROPHONE,
            session_time_ms=0,
            performance_time_ms=0.0,
            duration_ms=400,
            active=True,
            analyzable=True,
            confidence=0.9,
            observed_pitches=("C4",),
        )
    )
    accumulator.add_observation(
        PerformanceObservation(
            source=PerformanceObservationSource.MICROPHONE,
            session_time_ms=400,
            performance_time_ms=400.0,
            duration_ms=300,
            active=True,
            analyzable=False,
            confidence=0.2,
        )
    )
    accumulator.add_observation(
        PerformanceObservation(
            source=PerformanceObservationSource.MICROPHONE,
            session_time_ms=700,
            performance_time_ms=700.0,
            duration_ms=300,
            active=False,
            analyzable=True,
            confidence=0.8,
        )
    )
    accumulator.add_outcome(
        PerformanceExpectedEventOutcome(
            expected_group_id="entry-1",
            performance_time_ms=500.0,
            result=PerformanceExpectedEventResult.MATCH,
            confidence=0.95,
            source=PerformanceObservationSource.MICROPHONE,
            timing_offset_ms=-25.0,
        )
    )

    metrics = accumulator.metrics()

    assert metrics["completion_reason"] == "SCOPE_COMPLETED"
    assert metrics["scope_kind"] == "FULL_PIECE"
    assert metrics["input_activity_coverage"] == 0.7
    assert metrics["analyzable_coverage"] == 0.7
    assert metrics["confident_coverage"] == 0.4
    assert metrics["uncertain_coverage"] == 0.3
    assert metrics["matched_expected_groups"] == 1
    assert metrics["mismatched_expected_groups"] == 0
    assert metrics["average_timing_offset_ms"] == -25.0
    assert metrics["average_absolute_timing_offset_ms"] == 25.0


def test_performance_summary_accumulator_rejects_cross_source_evidence() -> None:
    accumulator = PerformanceSummaryAccumulator(
        completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
        input_source=PracticeInputSource.MIDI,
        scope_kind="FULL_PIECE",
        active_duration_ms=1_000,
    )

    with pytest.raises(ValueError, match="source must match"):
        accumulator.add_observation(
            PerformanceObservation(
                source=PerformanceObservationSource.MICROPHONE,
                session_time_ms=0,
                performance_time_ms=0.0,
                duration_ms=100,
                active=True,
                analyzable=True,
                confidence=1.0,
            )
        )


def test_performance_summary_accumulator_derives_scope_from_session() -> None:
    session = SimpleNamespace(
        completion_reason=PracticeSessionCompletionReason.STOPPED_BY_USER,
        input_source=PracticeInputSource.MIDI,
        scope_start_expected_group_id="entry-start",
        scope_end_expected_group_id="entry-end",
        started_at=None,
        finished_at=None,
    )

    metrics = PerformanceSummaryAccumulator.from_session(session).metrics()

    assert metrics["completion_reason"] == "STOPPED_BY_USER"
    assert metrics["scope_kind"] == "SELECTED_RANGE"
    assert metrics["active_duration_seconds"] is None
    assert metrics["analyzable_coverage"] is None


def test_performance_midi_evaluator_matches_expected_groups_on_clock_timebase() -> None:
    practice_timeline = score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
    )

    outcomes = evaluator.evaluate_midi(
        (
            PerformanceObservation(
                source=PerformanceObservationSource.MIDI,
                session_time_ms=0,
                performance_time_ms=0.0,
                duration_ms=100,
                active=True,
                analyzable=True,
                confidence=1.0,
                observed_pitches=("C4",),
            ),
            PerformanceObservation(
                source=PerformanceObservationSource.MIDI,
                session_time_ms=1_000,
                performance_time_ms=1_000.0,
                duration_ms=100,
                active=True,
                analyzable=True,
                confidence=1.0,
                observed_pitches=("E4",),
            ),
        )
    )

    assert [outcome.expected_group_id for outcome in outcomes] == ["entry-1", "entry-2", "entry-3"]
    assert [outcome.render_note_ids for outcome in outcomes] == [
        ("n1",),
        ("n2",),
        ("n3",),
    ]
    assert [outcome.measure_numbers for outcome in outcomes] == [("1",), ("1",), ("1",)]
    assert [outcome.result for outcome in outcomes] == [
        PerformanceExpectedEventResult.MATCH,
        PerformanceExpectedEventResult.NOT_OBSERVED,
        PerformanceExpectedEventResult.MATCH,
    ]
    assert [strike.result for strike in outcomes[0].expected_strike_outcomes] == [
        PerformanceExpectedStrikeResult.MATCHED
    ]
    assert [strike.result for strike in outcomes[1].expected_strike_outcomes] == [
        PerformanceExpectedStrikeResult.UNCONFIRMED
    ]


def test_performance_midi_evaluator_marks_only_missing_notes_in_partial_chord() -> None:
    practice_timeline = chord_score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
    )

    outcomes = evaluator.evaluate_midi(
        (
            PerformanceObservation(
                source=PerformanceObservationSource.MIDI,
                session_time_ms=0,
                performance_time_ms=0.0,
                duration_ms=100,
                active=True,
                analyzable=True,
                confidence=1.0,
                observed_pitches=("C4",),
            ),
            PerformanceObservation(
                source=PerformanceObservationSource.MIDI,
                session_time_ms=0,
                performance_time_ms=0.0,
                duration_ms=100,
                active=True,
                analyzable=True,
                confidence=1.0,
                observed_pitches=("E4",),
            ),
        )
    )

    assert len(outcomes) == 1
    assert outcomes[0].result == PerformanceExpectedEventResult.PARTIAL
    assert [
        (strike.render_note_ids, strike.pitch, strike.result)
        for strike in outcomes[0].expected_strike_outcomes
    ] == [
        (("n1",), "C4", PerformanceExpectedStrikeResult.MATCHED),
        (("n2",), "E4", PerformanceExpectedStrikeResult.MATCHED),
        (("n3",), "G4", PerformanceExpectedStrikeResult.MISSING),
    ]
    assert outcomes[0].unexpected_pitches == ()


def test_performance_midi_evaluator_matches_chord_notes_inside_simultaneity_window() -> None:
    practice_timeline = chord_score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
        midi_event_assignment_window_ms=300.0,
        midi_chord_simultaneity_window_ms=120.0,
    )

    outcomes = evaluator.evaluate_midi(
        (
            midi_observation("C4", performance_time_ms=0.0),
            midi_observation("E4", performance_time_ms=60.0),
            midi_observation("G4", performance_time_ms=110.0),
        )
    )

    assert len(outcomes) == 1
    assert outcomes[0].result == PerformanceExpectedEventResult.MATCH
    assert [strike.result for strike in outcomes[0].expected_strike_outcomes] == [
        PerformanceExpectedStrikeResult.MATCHED,
        PerformanceExpectedStrikeResult.MATCHED,
        PerformanceExpectedStrikeResult.MATCHED,
    ]
    assert outcomes[0].unexpected_pitches == ()


def test_performance_midi_evaluator_keeps_late_expected_chord_note_out_of_public_extra() -> None:
    practice_timeline = chord_score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
        midi_event_assignment_window_ms=300.0,
        midi_chord_simultaneity_window_ms=120.0,
    )

    outcomes = evaluator.evaluate_midi(
        (
            midi_observation("C4", performance_time_ms=0.0),
            midi_observation("E4", performance_time_ms=60.0),
            midi_observation("G4", performance_time_ms=260.0),
        )
    )

    assert len(outcomes) == 1
    assert outcomes[0].result == PerformanceExpectedEventResult.PARTIAL
    assert [
        (strike.pitch, strike.result)
        for strike in outcomes[0].expected_strike_outcomes
    ] == [
        ("C4", PerformanceExpectedStrikeResult.MATCHED),
        ("E4", PerformanceExpectedStrikeResult.MATCHED),
        ("G4", PerformanceExpectedStrikeResult.UNCONFIRMED),
    ]
    assert outcomes[0].unexpected_pitches == ()


def test_performance_midi_evaluator_reports_late_repeated_expected_pitch_as_extra() -> None:
    practice_timeline = chord_score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
        midi_event_assignment_window_ms=300.0,
        midi_chord_simultaneity_window_ms=120.0,
    )

    outcomes = evaluator.evaluate_midi(
        (
            midi_observation("C4", performance_time_ms=0.0),
            midi_observation("E4", performance_time_ms=60.0),
            midi_observation("G4", performance_time_ms=110.0),
            midi_observation("G4", performance_time_ms=260.0),
        )
    )

    assert len(outcomes) == 1
    assert outcomes[0].result == PerformanceExpectedEventResult.MISMATCH
    assert [strike.result for strike in outcomes[0].expected_strike_outcomes] == [
        PerformanceExpectedStrikeResult.MATCHED,
        PerformanceExpectedStrikeResult.MATCHED,
        PerformanceExpectedStrikeResult.MATCHED,
    ]
    assert outcomes[0].unexpected_pitches == ("G4",)


def test_performance_midi_evaluator_collapses_duplicate_notation_notes_to_one_strike() -> None:
    practice_timeline = duplicate_pitch_score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
    )

    outcomes = evaluator.evaluate_midi(
        (
            PerformanceObservation(
                source=PerformanceObservationSource.MIDI,
                session_time_ms=0,
                performance_time_ms=0.0,
                duration_ms=100,
                active=True,
                analyzable=True,
                confidence=1.0,
                observed_pitches=("C4",),
            ),
        )
    )

    assert len(outcomes) == 1
    assert outcomes[0].result == PerformanceExpectedEventResult.MATCH
    assert [
        (strike.render_note_ids, strike.pitch, strike.result)
        for strike in outcomes[0].expected_strike_outcomes
    ] == [
        (("n1", "n2"), "C4", PerformanceExpectedStrikeResult.MATCHED),
    ]
    assert outcomes[0].unexpected_pitches == ()


def test_performance_midi_evaluator_reports_repeated_expected_pitch_as_extra_attack() -> None:
    practice_timeline = duplicate_pitch_score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
    )

    outcomes = evaluator.evaluate_midi(
        (
            PerformanceObservation(
                source=PerformanceObservationSource.MIDI,
                session_time_ms=0,
                performance_time_ms=0.0,
                duration_ms=100,
                active=True,
                analyzable=True,
                confidence=1.0,
                observed_pitches=("C4",),
            ),
            PerformanceObservation(
                source=PerformanceObservationSource.MIDI,
                session_time_ms=10,
                performance_time_ms=10.0,
                duration_ms=100,
                active=True,
                analyzable=True,
                confidence=1.0,
                observed_pitches=("C4",),
            ),
        )
    )

    assert len(outcomes) == 1
    assert outcomes[0].result == PerformanceExpectedEventResult.MISMATCH
    assert outcomes[0].expected_strike_outcomes[0].result == PerformanceExpectedStrikeResult.MATCHED
    assert outcomes[0].unexpected_pitches == ("C4",)


def test_performance_midi_evaluator_consumes_observation_for_only_one_same_pitch_target() -> None:
    practice_timeline = repeated_pitch_score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
    )

    outcomes = evaluator.evaluate_midi(
        (
            midi_observation("C4", performance_time_ms=0.0),
            midi_observation("C4", performance_time_ms=500.0),
        )
    )

    assert [outcome.result for outcome in outcomes] == [
        PerformanceExpectedEventResult.MATCH,
        PerformanceExpectedEventResult.MATCH,
    ]
    assert [outcome.unexpected_pitches for outcome in outcomes] == [(), ()]


def test_performance_midi_evaluator_does_not_reuse_same_pitch_observation_for_next_target() -> None:
    practice_timeline = repeated_pitch_score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
    )

    outcomes = evaluator.evaluate_midi((midi_observation("C4", performance_time_ms=0.0),))

    assert [outcome.result for outcome in outcomes] == [
        PerformanceExpectedEventResult.MATCH,
        PerformanceExpectedEventResult.NOT_OBSERVED,
    ]


def test_performance_midi_evaluator_ignores_notes_outside_assignment_window() -> None:
    practice_timeline = repeated_pitch_score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
        midi_event_assignment_window_ms=100.0,
    )

    outcomes = evaluator.evaluate_midi((midi_observation("C4", performance_time_ms=250.0),))

    assert [outcome.result for outcome in outcomes] == [
        PerformanceExpectedEventResult.NOT_OBSERVED,
        PerformanceExpectedEventResult.NOT_OBSERVED,
    ]


def test_performance_midi_evaluator_keeps_late_chord_note_out_of_previous_dense_event() -> None:
    practice_timeline = dense_chord_score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
        midi_event_assignment_window_ms=250.0,
        midi_chord_simultaneity_window_ms=120.0,
    )

    outcomes = evaluator.evaluate_midi(
        (
            midi_observation("C4", performance_time_ms=0.0),
            midi_observation("E4", performance_time_ms=60.0),
            midi_observation("G4", performance_time_ms=210.0),
            midi_observation("D4", performance_time_ms=250.0),
        )
    )

    assert [outcome.expected_group_id for outcome in outcomes] == [
        "entry-dense-chord",
        "entry-dense-next",
    ]
    assert outcomes[0].result == PerformanceExpectedEventResult.PARTIAL
    assert [
        (strike.pitch, strike.result)
        for strike in outcomes[0].expected_strike_outcomes
    ] == [
        ("C4", PerformanceExpectedStrikeResult.MATCHED),
        ("E4", PerformanceExpectedStrikeResult.MATCHED),
        ("G4", PerformanceExpectedStrikeResult.MISSING),
    ]
    assert outcomes[0].unexpected_pitches == ()
    assert outcomes[1].result == PerformanceExpectedEventResult.MISMATCH
    assert outcomes[1].expected_strike_outcomes[0].result == PerformanceExpectedStrikeResult.MATCHED
    assert outcomes[1].unexpected_pitches == ("G4",)


def test_performance_midi_evaluator_assigns_dense_single_note_to_nearest_event() -> None:
    practice_timeline = dense_single_note_score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(practice_timeline)
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
        midi_event_assignment_window_ms=250.0,
    )

    outcomes = evaluator.evaluate_midi((midi_observation("C4", performance_time_ms=190.0),))

    assert [outcome.result for outcome in outcomes] == [
        PerformanceExpectedEventResult.NOT_OBSERVED,
        PerformanceExpectedEventResult.MISMATCH,
    ]
    assert outcomes[1].expected_strike_outcomes[0].result == PerformanceExpectedStrikeResult.MISSING
    assert outcomes[1].unexpected_pitches == ("C4",)


def test_performance_summary_exposes_midi_targets_for_evidence_backed_annotations() -> None:
    session = SimpleNamespace(
        completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
        input_source=PracticeInputSource.MIDI,
        scope_start_expected_group_id=None,
        scope_end_expected_group_id=None,
        started_at=None,
        finished_at=None,
        state=PracticeSessionState.FINISHED,
        access_origin=SimpleNamespace(value="OWNER"),
        progression_mode=PracticeProgressionMode.CONTINUOUS,
        realtime_guidance=PracticeRealtimeGuidance.STATUS_ONLY,
        evaluation_profile=PracticeEvaluationProfile.PERFORMANCE,
    )

    payload = PracticeSessionSummaryBuilder().build(
        session,
        performance_outcomes=(
            PerformanceExpectedEventOutcome(
                expected_group_id="entry-1",
                performance_time_ms=0.0,
                result=PerformanceExpectedEventResult.MATCH,
                confidence=1.0,
                source=PerformanceObservationSource.MIDI,
                expected_strike_outcomes=(
                    PerformanceExpectedStrikeOutcome(
                        strike_id="entry-1:strike:C4",
                        pitch="C4",
                        render_note_ids=("n1",),
                        result=PerformanceExpectedStrikeResult.MATCHED,
                    ),
                ),
                render_note_ids=("n1",),
                measure_numbers=("1",),
            ),
            PerformanceExpectedEventOutcome(
                expected_group_id="entry-2",
                performance_time_ms=1_000.0,
                result=PerformanceExpectedEventResult.MISMATCH,
                confidence=1.0,
                source=PerformanceObservationSource.MIDI,
                expected_strike_outcomes=(
                    PerformanceExpectedStrikeOutcome(
                        strike_id="entry-2:strike:D4",
                        pitch="D4",
                        render_note_ids=("n2",),
                        result=PerformanceExpectedStrikeResult.MATCHED,
                    ),
                    PerformanceExpectedStrikeOutcome(
                        strike_id="entry-2:strike:F4",
                        pitch="F4",
                        render_note_ids=("n3",),
                        result=PerformanceExpectedStrikeResult.MISSING,
                    ),
                ),
                unexpected_pitches=("G4",),
                render_note_ids=("n2", "n3"),
                measure_numbers=("1",),
            ),
            PerformanceExpectedEventOutcome(
                expected_group_id="entry-3",
                performance_time_ms=2_000.0,
                result=PerformanceExpectedEventResult.NOT_OBSERVED,
                confidence=0.0,
                source=PerformanceObservationSource.MIDI,
                render_note_ids=("n4",),
                measure_numbers=("2",),
            ),
        ),
    )

    assert [target["last_result"] for target in payload["targets"]] == [
        "MATCH",
        "MISMATCH",
        "NOT_OBSERVED",
    ]
    assert payload["targets"][0]["render_note_ids"] == ["n1"]
    assert payload["targets"][1]["render_note_ids"] == ["n2", "n3"]
    assert payload["targets"][0]["confirmed_correct_render_note_ids"] == ["n1"]
    assert payload["targets"][1]["confirmed_correct_render_note_ids"] == ["n2"]
    assert payload["targets"][1]["confirmed_error_render_note_ids"] == ["n3"]
    assert payload["targets"][1]["missing_pitches"] == ["F4"]
    assert payload["targets"][1]["unexpected_pitches"] == ["G4"]
    assert payload["targets"][2]["render_note_ids"] == ["n4"]
    assert payload["targets"][2]["confirmed_correct_render_note_ids"] == []
    assert payload["targets"][2]["confirmed_error_render_note_ids"] == []
    assert [measure["measure_number"] for measure in payload["problem_measures"]] == ["1"]
    assert payload["metrics"]["confirmed_correct_strike_targets"] == 2
    assert payload["metrics"]["missing_strike_targets"] == 1
    assert payload["metrics"]["extra_pitch_count"] == 1
    assert payload["metrics"]["problem_measure_count"] == 1


def test_performance_summary_keeps_unconfirmed_expected_strikes_neutral() -> None:
    session = SimpleNamespace(
        completion_reason=PracticeSessionCompletionReason.SCOPE_COMPLETED,
        input_source=PracticeInputSource.MIDI,
        scope_start_expected_group_id=None,
        scope_end_expected_group_id=None,
        started_at=None,
        finished_at=None,
        state=PracticeSessionState.FINISHED,
        access_origin=SimpleNamespace(value="OWNER"),
        progression_mode=PracticeProgressionMode.CONTINUOUS,
        realtime_guidance=PracticeRealtimeGuidance.STATUS_ONLY,
        evaluation_profile=PracticeEvaluationProfile.PERFORMANCE,
    )

    payload = PracticeSessionSummaryBuilder().build(
        session,
        performance_outcomes=(
            PerformanceExpectedEventOutcome(
                expected_group_id="entry-1",
                performance_time_ms=0.0,
                result=PerformanceExpectedEventResult.PARTIAL,
                confidence=1.0,
                source=PerformanceObservationSource.MIDI,
                expected_strike_outcomes=(
                    PerformanceExpectedStrikeOutcome(
                        strike_id="entry-1:strike:C4",
                        pitch="C4",
                        render_note_ids=("n1",),
                        result=PerformanceExpectedStrikeResult.MATCHED,
                    ),
                    PerformanceExpectedStrikeOutcome(
                        strike_id="entry-1:strike:G4",
                        pitch="G4",
                        render_note_ids=("n2",),
                        result=PerformanceExpectedStrikeResult.UNCONFIRMED,
                    ),
                ),
                render_note_ids=("n1", "n2"),
                measure_numbers=("1",),
            ),
        ),
    )

    target = payload["targets"][0]
    assert target["confirmed_correct_render_note_ids"] == ["n1"]
    assert target["confirmed_error_render_note_ids"] == []
    assert target["missing_pitches"] == []
    assert payload["metrics"]["missing_strike_targets"] == 0
    assert payload["metrics"]["problem_measure_count"] == 1


def test_performance_midi_evaluator_limits_outcomes_to_selected_scope() -> None:
    practice_timeline = score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(practice_timeline)
    scope = timeline.resolve_scope(
        practice_timeline,
        start_expected_group_id="entry-2",
        end_expected_group_id="entry-3",
    )
    evaluator = PerformanceExpectedEventEvaluator(
        score_timeline=practice_timeline,
        timeline=timeline,
        scope=scope,
    )

    outcomes = evaluator.evaluate_midi(())

    assert [outcome.expected_group_id for outcome in outcomes] == ["entry-2", "entry-3"]
    assert all(outcome.result == PerformanceExpectedEventResult.NOT_OBSERVED for outcome in outcomes)


def chord_score_timeline() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-chord",
                onset_beat=1.0,
                duration_beats=1.0,
                pitches=("C4", "E4", "G4"),
                render_note_ids=("n1", "n2", "n3"),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
        ),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-chord",
                onset_beat=1.0,
                event_ids=("event-chord",),
                render_note_ids=("n1", "n2", "n3"),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-chord",
        first_playable_beat=1.0,
        end_beat=2.0,
    )


def duplicate_pitch_score_timeline() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-unison-a",
                onset_beat=1.0,
                duration_beats=1.0,
                pitches=("C4",),
                render_note_ids=("n1",),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
            PracticeScoreEvent(
                event_id="event-unison-b",
                onset_beat=1.0,
                duration_beats=1.0,
                pitches=("C4",),
                render_note_ids=("n2",),
                measure_numbers=("1",),
                staff_ids=("2",),
                voice_ids=("2",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
        ),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-unison",
                onset_beat=1.0,
                event_ids=("event-unison-a", "event-unison-b"),
                render_note_ids=("n1", "n2"),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-unison-a",
        first_playable_beat=1.0,
        end_beat=2.0,
    )


def repeated_pitch_score_timeline() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-c4-a",
                onset_beat=1.0,
                duration_beats=1.0,
                pitches=("C4",),
                render_note_ids=("n1",),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
            PracticeScoreEvent(
                event_id="event-c4-b",
                onset_beat=2.0,
                duration_beats=1.0,
                pitches=("C4",),
                render_note_ids=("n2",),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
        ),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-c4-a",
                onset_beat=1.0,
                event_ids=("event-c4-a",),
                render_note_ids=("n1",),
                entry_candidate=True,
            ),
            PracticeEntryGroup(
                group_id="entry-c4-b",
                onset_beat=2.0,
                event_ids=("event-c4-b",),
                render_note_ids=("n2",),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-c4-a",
        first_playable_beat=1.0,
        end_beat=3.0,
    )


def dense_chord_score_timeline() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-dense-chord",
                onset_beat=1.0,
                duration_beats=0.5,
                pitches=("C4", "E4", "G4"),
                render_note_ids=("n1", "n2", "n3"),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
            PracticeScoreEvent(
                event_id="event-dense-next",
                onset_beat=1.5,
                duration_beats=0.5,
                pitches=("D4",),
                render_note_ids=("n4",),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
        ),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-dense-chord",
                onset_beat=1.0,
                event_ids=("event-dense-chord",),
                render_note_ids=("n1", "n2", "n3"),
                entry_candidate=True,
            ),
            PracticeEntryGroup(
                group_id="entry-dense-next",
                onset_beat=1.5,
                event_ids=("event-dense-next",),
                render_note_ids=("n4",),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-dense-chord",
        first_playable_beat=1.0,
        end_beat=2.0,
    )


def dense_single_note_score_timeline() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-dense-c4",
                onset_beat=1.0,
                duration_beats=0.5,
                pitches=("C4",),
                render_note_ids=("n1",),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
            PracticeScoreEvent(
                event_id="event-dense-d4",
                onset_beat=1.5,
                duration_beats=0.5,
                pitches=("D4",),
                render_note_ids=("n2",),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
        ),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-dense-c4",
                onset_beat=1.0,
                event_ids=("event-dense-c4",),
                render_note_ids=("n1",),
                entry_candidate=True,
            ),
            PracticeEntryGroup(
                group_id="entry-dense-d4",
                onset_beat=1.5,
                event_ids=("event-dense-d4",),
                render_note_ids=("n2",),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-dense-c4",
        first_playable_beat=1.0,
        end_beat=2.0,
    )


def midi_observation(pitch: str, *, performance_time_ms: float) -> PerformanceObservation:
    return PerformanceObservation(
        source=PerformanceObservationSource.MIDI,
        session_time_ms=round(performance_time_ms),
        performance_time_ms=performance_time_ms,
        duration_ms=100,
        active=True,
        analyzable=True,
        confidence=1.0,
        observed_pitches=(pitch,),
    )
