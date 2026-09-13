from __future__ import annotations

import pytest

from app.processing.engines.practice_alignment.score_timeline import (
    PracticeEntryGroup,
    PracticeScoreEvent,
    PracticeScoreTimeline,
)
from app.processing.performance.timeline import (
    PerformanceScopeInvalidRange,
    PerformanceScopeTargetNotFound,
    PerformanceTimeline,
    PerformanceTimelineError,
    TempoSegment,
)


def test_performance_timeline_maps_beats_with_default_tempo() -> None:
    timeline = PerformanceTimeline.from_score_timeline(_score_timeline())

    assert timeline.nominal_duration_ms == 3000
    assert timeline.beat_to_time_ms(3.0) == 1500
    assert timeline.time_ms_to_beat(2250) == 4.5


def test_performance_timeline_applies_tempo_map_as_score_truth() -> None:
    timeline = PerformanceTimeline.from_score_timeline(
        _score_timeline(),
        tempo_segments=(
            TempoSegment(start_beat=0.0, bpm=120),
            TempoSegment(start_beat=4.0, bpm=60),
        ),
    )

    assert timeline.beat_to_time_ms(4.0) == 2000
    assert timeline.beat_to_time_ms(5.0) == 3000
    assert timeline.time_ms_to_beat(2500) == 4.5


def test_performance_timeline_projection_preserves_tempo_segments_inside_scope() -> None:
    score_timeline = _score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(
        score_timeline,
        tempo_segments=(
            TempoSegment(start_beat=0.0, bpm=120),
            TempoSegment(start_beat=4.0, bpm=60),
        ),
    )
    groups = score_timeline.expected_practice_groups
    scope = timeline.resolve_scope(
        score_timeline,
        start_expected_group_id=groups[0].group_id,
        end_expected_group_id=groups[1].group_id,
    )

    projection = timeline.projection_for_scope(scope)

    assert projection.scope_start_beat == 3.0
    assert projection.scope_terminal_beat == 6.0
    assert [
        (
            segment.start_performance_time_ms,
            segment.end_performance_time_ms,
            segment.start_beat,
            segment.end_beat,
        )
        for segment in projection.segments
    ] == [
        (0.0, 500.0, 3.0, 4.0),
        (500.0, 2500.0, 4.0, 6.0),
    ]


def test_performance_timeline_rejects_invalid_tempo() -> None:
    with pytest.raises(PerformanceTimelineError):
        PerformanceTimeline.from_score_timeline(
            _score_timeline(),
            tempo_segments=(TempoSegment(start_beat=0.0, bpm=0),),
        )


def test_resolved_full_performance_scope_ends_at_score_end() -> None:
    score_timeline = _score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(score_timeline)

    scope = timeline.resolve_scope(score_timeline)

    assert scope.start_group_id is None
    assert scope.end_group_id is None
    assert scope.start_beat == 3.0
    assert scope.terminal_beat == 6.0
    assert scope.nominal_start_time_ms == 1500
    assert scope.nominal_end_time_ms == 3000
    assert scope.nominal_duration_ms == 1500


def test_resolved_full_performance_scope_includes_rest_after_last_target() -> None:
    score_timeline = _score_timeline_with_rest_after_final_target()
    timeline = PerformanceTimeline.from_score_timeline(score_timeline)

    scope = timeline.resolve_scope(score_timeline)

    assert scope.start_beat == 3.0
    assert scope.terminal_beat == 8.0
    assert scope.nominal_duration_ms == 2500


def test_resolved_selected_scope_ends_at_inclusive_end_group_musical_end() -> None:
    score_timeline = _score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(score_timeline)
    groups = score_timeline.expected_practice_groups

    scope = timeline.resolve_scope(
        score_timeline,
        start_expected_group_id=groups[1].group_id,
        end_expected_group_id=groups[1].group_id,
    )

    assert scope.start_group_id == groups[1].group_id
    assert scope.end_group_id == groups[1].group_id
    assert scope.start_beat == 4.0
    assert scope.terminal_beat == 6.0
    assert scope.nominal_start_time_ms == 2000
    assert scope.nominal_end_time_ms == 3000


def test_resolved_selected_scope_keeps_short_final_target_boundary() -> None:
    score_timeline = _score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(score_timeline)
    groups = score_timeline.expected_practice_groups

    scope = timeline.resolve_scope(
        score_timeline,
        start_expected_group_id=groups[2].group_id,
        end_expected_group_id=groups[2].group_id,
    )

    assert scope.start_beat == 4.05
    assert scope.terminal_beat == 4.55
    assert scope.nominal_duration_ms == 250


def test_resolved_selected_scope_uses_tie_start_target_not_tie_continuation() -> None:
    score_timeline = _score_timeline_with_tie_continuation()
    timeline = PerformanceTimeline.from_score_timeline(score_timeline)
    group = score_timeline.expected_practice_groups[0]

    scope = timeline.resolve_scope(
        score_timeline,
        start_expected_group_id=group.group_id,
        end_expected_group_id=group.group_id,
    )

    assert tuple(item.group_id for item in score_timeline.expected_practice_groups) == ("entry-3",)
    assert scope.start_beat == 3.0
    assert scope.terminal_beat == 5.0
    assert scope.nominal_duration_ms == 1000


def test_resolved_selected_scope_terminal_includes_tie_chain_end() -> None:
    score_timeline = _score_timeline_with_multi_fragment_tie_chain()
    timeline = PerformanceTimeline.from_score_timeline(score_timeline)
    group = score_timeline.expected_practice_groups[0]

    scope = timeline.resolve_scope(
        score_timeline,
        start_expected_group_id=group.group_id,
        end_expected_group_id=group.group_id,
    )

    assert tuple(item.group_id for item in score_timeline.expected_practice_groups) == ("entry-3",)
    assert scope.start_beat == 3.0
    assert scope.terminal_beat == 6.5
    assert scope.nominal_duration_ms == 1750


def test_resolved_selected_scope_rejects_reversed_range() -> None:
    score_timeline = _score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(score_timeline)
    groups = score_timeline.expected_practice_groups

    with pytest.raises(PerformanceScopeInvalidRange):
        timeline.resolve_scope(
            score_timeline,
            start_expected_group_id=groups[2].group_id,
            end_expected_group_id=groups[0].group_id,
        )


def test_resolved_selected_scope_rejects_unknown_target() -> None:
    score_timeline = _score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(score_timeline)

    with pytest.raises(PerformanceScopeTargetNotFound):
        timeline.resolve_scope(score_timeline, start_expected_group_id="missing")


def _score_timeline() -> PracticeScoreTimeline:
    events = (
        PracticeScoreEvent(
            event_id="event-3",
            onset_beat=3.0,
            duration_beats=0.25,
            pitches=("A5",),
            render_note_ids=("n1",),
            measure_numbers=("1",),
            staff_ids=("1",),
            voice_ids=("1",),
            tie_types=(),
            playable=True,
            entry_candidate=True,
        ),
        PracticeScoreEvent(
            event_id="event-4-upper",
            onset_beat=4.0,
            duration_beats=1.0,
            pitches=("C4", "E4"),
            render_note_ids=("n2", "n3"),
            measure_numbers=("2",),
            staff_ids=("1",),
            voice_ids=("1",),
            tie_types=(),
            playable=True,
            entry_candidate=True,
        ),
        PracticeScoreEvent(
            event_id="event-4-lower",
            onset_beat=4.0,
            duration_beats=2.0,
            pitches=("C3",),
            render_note_ids=("n4",),
            measure_numbers=("2",),
            staff_ids=("2",),
            voice_ids=("2",),
            tie_types=(),
            playable=True,
            entry_candidate=True,
        ),
        PracticeScoreEvent(
            event_id="event-4.05",
            onset_beat=4.05,
            duration_beats=0.5,
            pitches=("G4",),
            render_note_ids=("n5",),
            measure_numbers=("2",),
            staff_ids=("1",),
            voice_ids=("1",),
            tie_types=(),
            playable=True,
            entry_candidate=True,
        ),
    )
    return PracticeScoreTimeline(
        events=events,
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-3",
                onset_beat=3.0,
                event_ids=("event-3",),
                render_note_ids=("n1",),
                entry_candidate=True,
            ),
            PracticeEntryGroup(
                group_id="entry-4",
                onset_beat=4.0,
                event_ids=("event-4-upper", "event-4-lower"),
                render_note_ids=("n2", "n3", "n4"),
                entry_candidate=True,
            ),
            PracticeEntryGroup(
                group_id="entry-4.05",
                onset_beat=4.05,
                event_ids=("event-4.05",),
                render_note_ids=("n5",),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-3",
        first_playable_beat=3.0,
        end_beat=6.0,
    )


def _score_timeline_with_rest_after_final_target() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-3",
                onset_beat=3.0,
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
        ),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-3",
                onset_beat=3.0,
                event_ids=("event-3",),
                render_note_ids=("n1",),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-3",
        first_playable_beat=3.0,
        end_beat=8.0,
    )


def _score_timeline_with_tie_continuation() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-3",
                onset_beat=3.0,
                duration_beats=2.0,
                pitches=("C4",),
                render_note_ids=("n1",),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=("start",),
                playable=True,
                entry_candidate=True,
            ),
            PracticeScoreEvent(
                event_id="event-4",
                onset_beat=4.0,
                duration_beats=1.0,
                pitches=("C4",),
                render_note_ids=("n2",),
                measure_numbers=("2",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=("stop",),
                playable=True,
                entry_candidate=False,
            ),
        ),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-3",
                onset_beat=3.0,
                event_ids=("event-3",),
                render_note_ids=("n1",),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-3",
        first_playable_beat=3.0,
        end_beat=5.0,
    )


def _score_timeline_with_multi_fragment_tie_chain() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-3",
                onset_beat=3.0,
                duration_beats=1.0,
                pitches=("C4",),
                render_note_ids=("n1",),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=("start",),
                playable=True,
                entry_candidate=True,
            ),
            PracticeScoreEvent(
                event_id="event-4",
                onset_beat=4.0,
                duration_beats=1.0,
                pitches=("C4",),
                render_note_ids=("n2",),
                measure_numbers=("2",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=("stop", "start"),
                playable=True,
                entry_candidate=True,
            ),
            PracticeScoreEvent(
                event_id="event-5",
                onset_beat=5.0,
                duration_beats=1.5,
                pitches=("C4",),
                render_note_ids=("n3",),
                measure_numbers=("3",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=("stop",),
                playable=True,
                entry_candidate=False,
            ),
        ),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-3",
                onset_beat=3.0,
                event_ids=("event-3",),
                render_note_ids=("n1",),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-3",
        first_playable_beat=3.0,
        end_beat=6.5,
    )
