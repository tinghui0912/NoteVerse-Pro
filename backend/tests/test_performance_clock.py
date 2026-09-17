from __future__ import annotations

import pytest

from app.processing.engines.practice_alignment.score_timeline import (
    PracticeEntryGroup,
    PracticeScoreEvent,
    PracticeScoreTimeline,
)
from app.processing.performance.clock import (
    PerformanceClock,
    PerformanceClockError,
    PerformanceClockState,
)
from app.processing.performance.timeline import PerformanceTimeline, TempoSegment


def test_performance_clock_starts_with_count_in_before_running() -> None:
    clock = _clock(count_in_duration_beats=2, count_in_pulses=2)

    started = clock.start(now_ms=1_000)
    during_count_in = clock.snapshot(now_ms=1_500)
    running = clock.snapshot(now_ms=2_000)

    assert started.state == PerformanceClockState.COUNT_IN
    assert started.musical_beat == 3.0
    assert started.count_in_remaining_ms == 1000
    assert started.count_in_remaining_pulses == 2
    assert during_count_in.state == PerformanceClockState.COUNT_IN
    assert during_count_in.musical_beat == 3.0
    assert during_count_in.count_in_remaining_ms == 500
    assert during_count_in.count_in_remaining_pulses == 1
    assert running.state == PerformanceClockState.RUNNING
    assert running.musical_beat == 3.0
    assert running.count_in_remaining_ms == 0
    assert running.count_in_remaining_pulses == 0


def test_performance_clock_advances_from_elapsed_time_after_count_in() -> None:
    clock = _clock(count_in_duration_beats=2, count_in_pulses=2)
    clock.start(now_ms=1_000)

    snapshot = clock.snapshot(now_ms=2_500)

    assert snapshot.state == PerformanceClockState.RUNNING
    assert snapshot.performance_elapsed_ms == 500
    assert snapshot.musical_beat == 4.0
    assert snapshot.scope_completed is False


def test_performance_clock_completes_when_scope_duration_elapses() -> None:
    clock = _clock(count_in_duration_beats=2, count_in_pulses=2)
    clock.start(now_ms=1_000)

    before_end = clock.snapshot(now_ms=2_999)
    ended = clock.snapshot(now_ms=3_000)
    later = clock.snapshot(now_ms=9_000)

    assert before_end.state == PerformanceClockState.RUNNING
    assert before_end.scope_completed is False
    assert ended.state == PerformanceClockState.ENDED
    assert ended.scope_completed is True
    assert ended.musical_beat == 5.0
    assert later.state == PerformanceClockState.ENDED
    assert later.musical_beat == 5.0


def test_performance_clock_pause_freezes_running_elapsed_time() -> None:
    clock = _clock(count_in_duration_beats=0, count_in_pulses=0)
    clock.start(now_ms=1_000)

    paused = clock.pause(now_ms=1_250)
    still_paused = clock.snapshot(now_ms=2_250)
    resumed = clock.resume(now_ms=2_250)
    after_resume = clock.snapshot(now_ms=2_500)

    assert paused.state == PerformanceClockState.PAUSED
    assert paused.performance_elapsed_ms == 250
    assert still_paused.performance_elapsed_ms == 250
    assert resumed.state == PerformanceClockState.RUNNING
    assert resumed.performance_elapsed_ms == 250
    assert after_resume.performance_elapsed_ms == 500
    assert after_resume.musical_beat == 4.0


def test_performance_clock_pause_freezes_count_in_elapsed_time() -> None:
    clock = _clock(count_in_duration_beats=2, count_in_pulses=2)
    clock.start(now_ms=1_000)

    paused = clock.pause(now_ms=1_250)
    still_paused = clock.snapshot(now_ms=5_000)
    resumed = clock.resume(now_ms=5_000)
    still_counting = clock.snapshot(now_ms=5_500)

    assert paused.state == PerformanceClockState.PAUSED
    assert paused.count_in_remaining_ms == 750
    assert paused.count_in_remaining_pulses == 1.5
    assert still_paused.count_in_remaining_ms == 750
    assert still_paused.count_in_remaining_pulses == 1.5
    assert resumed.state == PerformanceClockState.COUNT_IN
    assert still_counting.state == PerformanceClockState.COUNT_IN
    assert still_counting.count_in_remaining_ms == 250
    assert still_counting.count_in_remaining_pulses == 0.5


def test_performance_clock_pause_after_count_in_remembers_running_state() -> None:
    clock = _clock(count_in_duration_beats=2, count_in_pulses=2)
    clock.start(now_ms=1_000)

    running = clock.snapshot(now_ms=2_000)
    paused = clock.pause(now_ms=2_250)
    resumed = clock.resume(now_ms=3_250)

    assert running.state == PerformanceClockState.RUNNING
    assert clock.state == PerformanceClockState.RUNNING
    assert paused.state == PerformanceClockState.PAUSED
    assert paused.performance_elapsed_ms == 250
    assert resumed.state == PerformanceClockState.RUNNING
    assert resumed.performance_elapsed_ms == 250


def test_performance_clock_pause_at_count_in_boundary_is_running_pause() -> None:
    clock = _clock(count_in_duration_beats=2, count_in_pulses=2)
    clock.start(now_ms=1_000)

    paused = clock.pause(now_ms=2_000)
    resumed = clock.resume(now_ms=3_000)

    assert paused.state == PerformanceClockState.PAUSED
    assert paused.performance_elapsed_ms == 0
    assert resumed.state == PerformanceClockState.RUNNING
    assert resumed.performance_elapsed_ms == 0


def test_performance_clock_rejects_pause_after_terminal_boundary() -> None:
    clock = _clock(count_in_duration_beats=2, count_in_pulses=2)
    clock.start(now_ms=1_000)

    with pytest.raises(PerformanceClockError):
        clock.pause(now_ms=3_001)

    assert clock.state == PerformanceClockState.ENDED


def test_performance_clock_speed_ratio_changes_actual_clock_duration() -> None:
    clock = _clock(speed_ratio=0.5, count_in_duration_beats=0, count_in_pulses=0)
    clock.start(now_ms=0)

    halfway = clock.snapshot(now_ms=1_000)
    ended = clock.snapshot(now_ms=2_000)

    assert halfway.state == PerformanceClockState.RUNNING
    assert halfway.performance_elapsed_ms == 500
    assert halfway.musical_beat == 4.0
    assert ended.state == PerformanceClockState.ENDED
    assert ended.performance_elapsed_ms == 1000
    assert ended.musical_beat == 5.0


def test_performance_clock_count_in_uses_start_tempo_and_speed_ratio() -> None:
    timeline = PerformanceTimeline.from_score_timeline(
        _score_timeline(),
        tempo_segments=(
            TempoSegment(start_beat=0.0, bpm=120),
            TempoSegment(start_beat=3.0, bpm=60),
        ),
    )
    scope = timeline.resolve_scope(_score_timeline())
    clock = PerformanceClock(
        timeline=timeline,
        scope=scope,
        speed_ratio=0.5,
        count_in_duration_beats=2,
        count_in_pulses=2,
    )

    assert clock.count_in_ms == 4000


def test_performance_clock_rejects_invalid_configuration_and_transitions() -> None:
    with pytest.raises(PerformanceClockError):
        _clock(speed_ratio=0)
    with pytest.raises(PerformanceClockError):
        _clock(count_in_duration_beats=-1)
    with pytest.raises(PerformanceClockError):
        _clock(count_in_pulses=-1)

    clock = _clock()
    with pytest.raises(PerformanceClockError):
        clock.pause(now_ms=0)
    with pytest.raises(PerformanceClockError):
        clock.resume(now_ms=0)

    clock.start(now_ms=0)
    with pytest.raises(PerformanceClockError):
        clock.start(now_ms=1)


def _clock(
    *,
    speed_ratio: float = 1.0,
    count_in_duration_beats: float = 0.0,
    count_in_pulses: float = 0.0,
) -> PerformanceClock:
    score_timeline = _score_timeline()
    timeline = PerformanceTimeline.from_score_timeline(score_timeline)
    scope = timeline.resolve_scope(
        score_timeline,
        start_expected_group_id="entry-3",
        end_expected_group_id="entry-4",
    )
    return PerformanceClock(
        timeline=timeline,
        scope=scope,
        speed_ratio=speed_ratio,
        count_in_duration_beats=count_in_duration_beats,
        count_in_pulses=count_in_pulses,
    )


def _score_timeline() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-3",
                onset_beat=3.0,
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
                event_id="event-4",
                onset_beat=4.0,
                duration_beats=1.0,
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
                group_id="entry-3",
                onset_beat=3.0,
                event_ids=("event-3",),
                render_note_ids=("n1",),
                entry_candidate=True,
            ),
            PracticeEntryGroup(
                group_id="entry-4",
                onset_beat=4.0,
                event_ids=("event-4",),
                render_note_ids=("n2",),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-3",
        first_playable_beat=3.0,
        end_beat=5.0,
    )
