from __future__ import annotations

import pytest

from app.processing.engines.practice_alignment.score_timeline import PracticeMeterSegment
from app.processing.performance.clock import PerformanceClockError, PerformanceClockState
from app.processing.performance.evidence import (
    PerformanceExpectedEventResult,
    PerformanceEvidenceRecorder,
    PerformanceObservationSource,
)
from app.processing.performance.runtime import PerformanceRuntime
from app.processing.performance.timeline import PerformanceScopeTargetNotFound, TempoSegment
from app.processing.realtime.session_runtime import PerformancePracticeSessionRuntime
from tests.performance_timeline_fixtures import score_timeline


def test_performance_runtime_resolves_scope_and_starts_count_in() -> None:
    runtime = PerformanceRuntime(
        score_timeline=score_timeline(),
        start_expected_group_id="entry-2",
        end_expected_group_id="entry-3",
        count_in_duration_beats=2,
        count_in_pulses=2,
    )

    sync = runtime.start(now_ms=1_000)

    assert sync.state == PerformanceClockState.COUNT_IN
    assert sync.musical_beat == 2.0
    assert sync.scope_start_group_id == "entry-2"
    assert sync.scope_end_group_id == "entry-3"
    assert sync.scope_start_beat == 2.0
    assert sync.scope_terminal_beat == 4.0
    assert sync.nominal_scope_duration_ms == 1000
    assert sync.count_in_remaining_ms == 1000
    assert sync.count_in_remaining_pulses == 2
    assert sync.scope_completed is False


def test_performance_runtime_defaults_count_in_to_scope_start_meter_pulses() -> None:
    timeline = score_timeline()
    runtime = PerformanceRuntime(
        score_timeline=type(timeline)(
            events=timeline.events,
            entry_groups=timeline.entry_groups,
            first_playable_event_id=timeline.first_playable_event_id,
            first_playable_beat=timeline.first_playable_beat,
            end_beat=timeline.end_beat,
            meter_segments=(PracticeMeterSegment(start_beat=0.0, numerator=6, denominator=8),),
        ),
        start_expected_group_id="entry-2",
        end_expected_group_id="entry-3",
    )

    sync = runtime.start(now_ms=1_000)

    assert sync.count_in_remaining_ms == 1_500
    assert sync.count_in_remaining_pulses == 6


def test_performance_runtime_sync_advances_and_completes_by_clock() -> None:
    runtime = PerformanceRuntime(
        score_timeline=score_timeline(),
        start_expected_group_id="entry-2",
        end_expected_group_id="entry-3",
        count_in_duration_beats=0,
        count_in_pulses=0,
    )
    runtime.start(now_ms=0)

    halfway = runtime.sync(now_ms=500)
    ended = runtime.sync(now_ms=1_000)

    assert halfway.state == PerformanceClockState.RUNNING
    assert halfway.musical_beat == 3.0
    assert halfway.performance_time_ms == 500
    assert halfway.scope_completed is False
    assert ended.state == PerformanceClockState.ENDED
    assert ended.musical_beat == 4.0
    assert ended.performance_time_ms == 1000
    assert ended.scope_completed is True


def test_performance_runtime_pause_resume_freezes_clock_sync() -> None:
    runtime = PerformanceRuntime(
        score_timeline=score_timeline(),
        start_expected_group_id="entry-2",
        end_expected_group_id="entry-3",
        count_in_duration_beats=0,
        count_in_pulses=0,
    )
    runtime.start(now_ms=1_000)

    paused = runtime.pause(now_ms=1_250)
    still_paused = runtime.sync(now_ms=2_250)
    resumed = runtime.resume(now_ms=2_250)
    after_resume = runtime.sync(now_ms=2_500)

    assert paused.state == PerformanceClockState.PAUSED
    assert paused.performance_time_ms == 250
    assert still_paused.state == PerformanceClockState.PAUSED
    assert still_paused.performance_time_ms == 250
    assert resumed.state == PerformanceClockState.RUNNING
    assert resumed.performance_time_ms == 250
    assert after_resume.performance_time_ms == 500
    assert after_resume.musical_beat == 3.0


def test_performance_runtime_uses_tempo_segments_and_speed_ratio() -> None:
    runtime = PerformanceRuntime(
        score_timeline=score_timeline(),
        tempo_segments=(
            TempoSegment(start_beat=0.0, bpm=120),
            TempoSegment(start_beat=2.0, bpm=60),
        ),
        start_expected_group_id="entry-2",
        end_expected_group_id="entry-3",
        speed_ratio=0.5,
        count_in_duration_beats=2,
        count_in_pulses=2,
    )

    sync = runtime.start(now_ms=0)
    still_counting = runtime.sync(now_ms=3_999)
    running = runtime.sync(now_ms=4_000)

    assert sync.count_in_remaining_ms == 4000
    assert sync.count_in_remaining_pulses == 2
    assert sync.nominal_scope_duration_ms == 2000
    assert sync.speed_ratio == 0.5
    assert still_counting.state == PerformanceClockState.COUNT_IN
    assert still_counting.count_in_remaining_pulses == pytest.approx(0.0005)
    assert running.state == PerformanceClockState.RUNNING
    assert running.count_in_remaining_pulses == 0


def test_performance_runtime_projection_shares_speed_adjusted_clock_timebase() -> None:
    runtime = PerformanceRuntime(
        score_timeline=score_timeline(),
        tempo_segments=(
            TempoSegment(start_beat=0.0, bpm=120),
            TempoSegment(start_beat=2.0, bpm=60),
        ),
        start_expected_group_id="entry-1",
        end_expected_group_id="entry-3",
        speed_ratio=0.5,
        count_in_duration_beats=0,
        count_in_pulses=0,
    )
    runtime.start(now_ms=0)

    projection = runtime.timeline_projection()
    sync = runtime.sync(now_ms=2_000)

    assert sync.speed_ratio == 0.5
    assert sync.performance_time_ms == 1_000
    assert sync.musical_beat == 2.5
    assert [
        (
            segment.start_performance_time_ms,
            segment.end_performance_time_ms,
            segment.start_beat,
            segment.end_beat,
        )
        for segment in projection.segments
    ] == [
        (0.0, 500.0, 1.0, 2.0),
        (500.0, 2500.0, 2.0, 4.0),
    ]


def test_performance_runtime_preserves_full_scope_identity() -> None:
    runtime = PerformanceRuntime(score_timeline=score_timeline())

    sync = runtime.sync(now_ms=0)

    assert sync.state == PerformanceClockState.READY
    assert sync.scope_start_group_id is None
    assert sync.scope_end_group_id is None
    assert sync.scope_start_beat == 1.0
    assert sync.scope_terminal_beat == 5.0
    assert sync.nominal_scope_duration_ms == 2000


def test_performance_runtime_exposes_scope_timeline_projection() -> None:
    runtime = PerformanceRuntime(
        score_timeline=score_timeline(),
        tempo_segments=(
            TempoSegment(start_beat=0.0, bpm=120),
            TempoSegment(start_beat=2.0, bpm=60),
        ),
        start_expected_group_id="entry-1",
        end_expected_group_id="entry-3",
    )

    projection = runtime.timeline_projection()

    assert projection.scope_start_beat == 1.0
    assert projection.scope_terminal_beat == 4.0
    assert [
        (
            segment.start_performance_time_ms,
            segment.end_performance_time_ms,
            segment.start_beat,
            segment.end_beat,
        )
        for segment in projection.segments
    ] == [
        (0.0, 500.0, 1.0, 2.0),
        (500.0, 2500.0, 2.0, 4.0),
    ]


def test_performance_runtime_rejects_unknown_scope_target() -> None:
    with pytest.raises(PerformanceScopeTargetNotFound):
        PerformanceRuntime(
            score_timeline=score_timeline(),
            start_expected_group_id="missing",
        )


def test_performance_runtime_rejects_invalid_clock_configuration() -> None:
    with pytest.raises(PerformanceClockError):
        PerformanceRuntime(
            score_timeline=score_timeline(),
            speed_ratio=0,
        )


def test_performance_runtime_records_midi_observations_on_clock_timebase() -> None:
    runtime = _performance_session_runtime(input_source="MIDI")
    runtime.start_performance(now_ms=0)

    first = runtime.process_midi_event(
        event_type="note_on",
        note_number=60,
        velocity=90,
        input_session_time_ms=500,
    )
    second = runtime.process_midi_event(
        event_type="note_off",
        note_number=60,
        velocity=0,
        input_session_time_ms=800,
    )

    assert first is None
    assert second is not None
    assert second.source == PerformanceObservationSource.MIDI
    assert second.session_time_ms == 500
    assert second.performance_time_ms == 500
    assert second.duration_ms == 300
    assert second.observed_pitches == ("C4",)
    assert runtime.performance_observations == (second,)


def test_performance_runtime_maps_midi_input_time_through_speed_ratio() -> None:
    runtime = _performance_session_runtime(input_source="MIDI", speed_ratio=0.5)
    runtime.start_performance(now_ms=0)

    runtime.process_midi_event(
        event_type="note_on",
        note_number=60,
        velocity=90,
        input_session_time_ms=1_000,
    )
    observation = runtime.process_midi_event(
        event_type="note_off",
        note_number=60,
        velocity=0,
        input_session_time_ms=1_200,
    )

    assert observation is not None
    assert observation.session_time_ms == 1_000
    assert observation.performance_time_ms == 500
    assert observation.duration_ms == 200


def test_performance_runtime_records_audio_activity_without_moving_clock() -> None:
    runtime = _performance_session_runtime(input_source="MICROPHONE")
    runtime.start_performance(now_ms=0)

    before = runtime.performance_sync(now_ms=640)
    observation = runtime.process_audio_chunk((2000).to_bytes(2, "little", signed=True) * 640, now_ms=640)
    after = runtime.performance_sync(now_ms=640)

    assert observation is not None
    assert observation.source == PerformanceObservationSource.MICROPHONE
    assert observation.active is True
    assert observation.analyzable is True
    assert observation.duration_ms == 40
    assert before.performance_time_ms == after.performance_time_ms


def test_performance_runtime_count_in_before_resuming_from_running_pause() -> None:
    runtime = _performance_session_runtime(
        input_source="MICROPHONE",
        count_in_duration_beats=2,
        count_in_pulses=2,
    )
    runtime.start_performance(now_ms=0)
    assert runtime.performance_sync(now_ms=1_000).state == PerformanceClockState.RUNNING

    paused = runtime.pause_performance(now_ms=1_500)
    resumed = runtime.resume_performance(now_ms=2_000)
    during_count_in = runtime.performance_sync(now_ms=2_500)
    observation = runtime.process_audio_chunk(
        (2000).to_bytes(2, "little", signed=True) * 640,
        now_ms=2_500,
    )
    running = runtime.performance_sync(now_ms=4_000)

    assert paused.state == PerformanceClockState.PAUSED
    assert paused.performance_time_ms == 500
    assert resumed.state == PerformanceClockState.COUNT_IN
    assert resumed.performance_time_ms == 500
    assert resumed.count_in_remaining_ms == 2000
    assert resumed.count_in_remaining_pulses == 4
    assert during_count_in.state == PerformanceClockState.COUNT_IN
    assert during_count_in.performance_time_ms == 500
    assert during_count_in.count_in_remaining_ms == 1500
    assert during_count_in.count_in_remaining_pulses == 3
    assert observation is None
    assert runtime.performance_observations == ()
    assert running.state == PerformanceClockState.RUNNING
    assert running.performance_time_ms == 500


def test_performance_runtime_evaluates_midi_expected_event_outcomes() -> None:
    runtime = _performance_session_runtime(input_source="MIDI")
    runtime.start_performance(now_ms=0)

    runtime.process_midi_event(event_type="note_on", note_number=60, velocity=90, input_session_time_ms=0)
    runtime.process_midi_event(event_type="note_off", note_number=60, velocity=0, input_session_time_ms=100)
    runtime.process_midi_event(event_type="note_on", note_number=64, velocity=90, input_session_time_ms=1_000)
    runtime.process_midi_event(event_type="note_off", note_number=64, velocity=0, input_session_time_ms=1_100)

    outcomes = runtime.evaluate_expected_event_outcomes()

    assert [outcome.result for outcome in outcomes] == [
        PerformanceExpectedEventResult.MATCH,
        PerformanceExpectedEventResult.NOT_OBSERVED,
        PerformanceExpectedEventResult.MATCH,
    ]


def _performance_session_runtime(
    *,
    input_source: str,
    speed_ratio: float = 1.0,
    count_in_duration_beats: float = 0.0,
    count_in_pulses: float = 0.0,
) -> PerformancePracticeSessionRuntime:
    return PerformancePracticeSessionRuntime(
        session_id="session-1",
        task_id="task-1",
        state="STREAMING",
        score_file_path="score.musicxml",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        progression_mode="CONTINUOUS",
        realtime_guidance="STATUS_ONLY",
        evaluation_profile="PERFORMANCE",
        input_source=input_source,
        performance_runtime=PerformanceRuntime(
            score_timeline=score_timeline(),
            speed_ratio=speed_ratio,
            count_in_duration_beats=count_in_duration_beats,
            count_in_pulses=count_in_pulses,
        ),
        evidence_recorder=PerformanceEvidenceRecorder(
            source=PerformanceObservationSource(input_source),
            sample_rate=16000,
            channels=1,
        ),
    )
