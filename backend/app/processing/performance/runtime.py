from __future__ import annotations

from dataclasses import dataclass

from app.processing.engines.practice_alignment.score_timeline import (
    PracticeScoreTimeline,
    ScoreBeat,
)
from app.processing.performance.clock import (
    PerformanceClock,
    PerformanceClockSnapshot,
    PerformanceClockState,
)
from app.processing.performance.evidence import (
    PerformanceExpectedEventOutcome,
    PerformanceObservation,
    PerformanceObservationSource,
)
from app.processing.performance.evaluator import PerformanceExpectedEventEvaluator
from app.processing.performance.timeline import (
    PerformanceTimeline,
    PerformanceTimelineProjection,
    ResolvedPerformanceScope,
    TempoSegment,
)


@dataclass(frozen=True)
class PerformanceClockSync:
    state: PerformanceClockState
    musical_beat: ScoreBeat
    performance_time_ms: float
    count_in_remaining_ms: float
    count_in_remaining_pulses: float
    scope_completed: bool
    scope_start_group_id: str | None
    scope_end_group_id: str | None
    scope_start_beat: ScoreBeat
    scope_terminal_beat: ScoreBeat
    nominal_scope_duration_ms: float
    speed_ratio: float


class PerformanceRuntime:
    def __init__(
        self,
        *,
        score_timeline: PracticeScoreTimeline,
        tempo_segments: tuple[TempoSegment, ...] = (),
        start_expected_group_id: str | None = None,
        end_expected_group_id: str | None = None,
        speed_ratio: float = 1.0,
        count_in_duration_beats: float | None = None,
        count_in_pulses: float | None = None,
    ) -> None:
        self._score_timeline = score_timeline
        self._timeline = PerformanceTimeline.from_score_timeline(
            score_timeline,
            tempo_segments=tempo_segments,
        )
        self._scope = self._timeline.resolve_scope(
            score_timeline,
            start_expected_group_id=start_expected_group_id,
            end_expected_group_id=end_expected_group_id,
        )
        self._speed_ratio = speed_ratio
        resolved_count_in_duration_beats = (
            score_timeline.count_in_duration_beats_at(self._scope.start_beat)
            if count_in_duration_beats is None
            else count_in_duration_beats
        )
        resolved_count_in_pulses = (
            score_timeline.count_in_pulses_at(self._scope.start_beat)
            if count_in_pulses is None
            else count_in_pulses
        )
        self._clock = PerformanceClock(
            timeline=self._timeline,
            scope=self._scope,
            speed_ratio=speed_ratio,
            count_in_duration_beats=resolved_count_in_duration_beats,
            count_in_pulses=resolved_count_in_pulses,
        )

    @property
    def score_timeline(self) -> PracticeScoreTimeline:
        return self._score_timeline

    @property
    def timeline(self) -> PerformanceTimeline:
        return self._timeline

    @property
    def scope(self) -> ResolvedPerformanceScope:
        return self._scope

    @property
    def state(self) -> PerformanceClockState:
        return self._clock.state

    @property
    def paused_from_running(self) -> bool:
        return self._clock.paused_from_running

    def start(self, *, now_ms: int) -> PerformanceClockSync:
        return self._to_sync(self._clock.start(now_ms=now_ms))

    def pause(self, *, now_ms: int) -> PerformanceClockSync:
        return self._to_sync(self._clock.pause(now_ms=now_ms))

    def resume(self, *, now_ms: int) -> PerformanceClockSync:
        return self._to_sync(self._clock.resume(now_ms=now_ms))

    def sync(self, *, now_ms: int) -> PerformanceClockSync:
        return self._to_sync(self._clock.snapshot(now_ms=now_ms))

    def performance_time_for_session_active_time(self, *, session_active_time_ms: int) -> float:
        if session_active_time_ms < 0:
            raise ValueError("Performance session active time must be non-negative.")
        elapsed_after_count_in = max(0.0, session_active_time_ms - self._clock.count_in_ms)
        return min(
            elapsed_after_count_in * self._speed_ratio,
            self._scope.nominal_duration_ms,
        )

    def count_in_for_beat(self, beat: ScoreBeat) -> tuple[float, float]:
        duration_beats = self._score_timeline.count_in_duration_beats_at(beat)
        pulses = float(self._score_timeline.count_in_pulses_at(beat))
        bpm = self._timeline.bpm_at_beat(beat)
        return duration_beats * 60_000.0 / bpm / self._speed_ratio, pulses

    def timeline_projection(self) -> PerformanceTimelineProjection:
        return self._timeline.projection_for_scope(self._scope)

    def evaluate_expected_event_outcomes(
        self,
        *,
        source: PerformanceObservationSource,
        observations: tuple[PerformanceObservation, ...],
    ) -> tuple[PerformanceExpectedEventOutcome, ...]:
        if source != PerformanceObservationSource.MIDI:
            return ()
        evaluator = PerformanceExpectedEventEvaluator(
            score_timeline=self._score_timeline,
            timeline=self._timeline,
            scope=self._scope,
        )
        return evaluator.evaluate_midi(observations)

    def _to_sync(self, snapshot: PerformanceClockSnapshot) -> PerformanceClockSync:
        return PerformanceClockSync(
            state=snapshot.state,
            musical_beat=snapshot.musical_beat,
            performance_time_ms=snapshot.performance_elapsed_ms,
            count_in_remaining_ms=snapshot.count_in_remaining_ms,
            count_in_remaining_pulses=snapshot.count_in_remaining_pulses,
            scope_completed=snapshot.scope_completed,
            scope_start_group_id=self._scope.start_group_id,
            scope_end_group_id=self._scope.end_group_id,
            scope_start_beat=self._scope.start_beat,
            scope_terminal_beat=self._scope.terminal_beat,
            nominal_scope_duration_ms=self._scope.nominal_duration_ms,
            speed_ratio=self._speed_ratio,
        )
