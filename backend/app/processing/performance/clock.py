from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from app.processing.engines.practice_alignment.score_timeline import ScoreBeat
from app.processing.performance.timeline import PerformanceTimeline, ResolvedPerformanceScope


class PerformanceClockState(str, Enum):
    READY = "READY"
    COUNT_IN = "COUNT_IN"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    ENDED = "ENDED"


class PerformanceClockError(RuntimeError):
    pass


@dataclass(frozen=True)
class PerformanceClockSnapshot:
    state: PerformanceClockState
    now_ms: int
    musical_beat: ScoreBeat
    performance_elapsed_ms: float
    count_in_remaining_ms: float
    count_in_remaining_pulses: float
    scope_completed: bool


class PerformanceClock:
    def __init__(
        self,
        *,
        timeline: PerformanceTimeline,
        scope: ResolvedPerformanceScope,
        speed_ratio: float = 1.0,
        count_in_duration_beats: float = 0.0,
        count_in_pulses: float = 0.0,
    ) -> None:
        if speed_ratio <= 0:
            raise PerformanceClockError("Performance speed ratio must be positive.")
        if count_in_duration_beats < 0:
            raise PerformanceClockError("Performance count-in duration must not be negative.")
        if count_in_pulses < 0:
            raise PerformanceClockError("Performance count-in pulses must not be negative.")

        self._timeline = timeline
        self._scope = scope
        self._speed_ratio = speed_ratio
        self._count_in_pulses = count_in_pulses
        self._count_in_ms = self._count_in_duration_ms(count_in_duration_beats)
        self._state = PerformanceClockState.READY
        self._started_at_ms: int | None = None
        self._pause_started_at_ms: int | None = None
        self._paused_duration_ms = 0.0
        self._state_before_pause = PerformanceClockState.READY

    @property
    def state(self) -> PerformanceClockState:
        return self._state

    @property
    def count_in_ms(self) -> float:
        return self._count_in_ms

    @property
    def paused_from_running(self) -> bool:
        return (
            self._state == PerformanceClockState.PAUSED
            and self._state_before_pause == PerformanceClockState.RUNNING
        )

    def start(self, *, now_ms: int) -> PerformanceClockSnapshot:
        if self._state != PerformanceClockState.READY:
            raise PerformanceClockError("Performance clock can only start from READY.")
        self._started_at_ms = now_ms
        self._state = (
            PerformanceClockState.COUNT_IN
            if self._count_in_ms > 0
            else PerformanceClockState.RUNNING
        )
        return self.snapshot(now_ms=now_ms)

    def pause(self, *, now_ms: int) -> PerformanceClockSnapshot:
        self._advance_to(now_ms)
        if self._state not in {PerformanceClockState.COUNT_IN, PerformanceClockState.RUNNING}:
            raise PerformanceClockError("Performance clock can only pause while active.")
        self._state_before_pause = self._state
        self._state = PerformanceClockState.PAUSED
        self._pause_started_at_ms = now_ms
        return self.snapshot(now_ms=now_ms)

    def resume(self, *, now_ms: int) -> PerformanceClockSnapshot:
        if self._state != PerformanceClockState.PAUSED or self._pause_started_at_ms is None:
            raise PerformanceClockError("Performance clock can only resume from PAUSED.")
        self._paused_duration_ms += max(0.0, now_ms - self._pause_started_at_ms)
        self._pause_started_at_ms = None
        self._state = self._state_before_pause
        return self.snapshot(now_ms=now_ms)

    def snapshot(self, *, now_ms: int) -> PerformanceClockSnapshot:
        active_elapsed_ms = self._advance_to(now_ms)
        return self._snapshot(
            now_ms=now_ms,
            state=self._state,
            active_elapsed_ms=active_elapsed_ms,
        )

    def _advance_to(self, now_ms: int) -> float:
        if self._state == PerformanceClockState.READY:
            return 0.0

        active_elapsed_ms = self._active_elapsed_ms(now_ms)
        if self._state == PerformanceClockState.PAUSED:
            return active_elapsed_ms

        next_state = self._resolved_active_state(active_elapsed_ms)
        if next_state in {PerformanceClockState.RUNNING, PerformanceClockState.ENDED}:
            self._state = next_state
        return active_elapsed_ms

    def _snapshot(
        self,
        *,
        now_ms: int,
        state: PerformanceClockState,
        active_elapsed_ms: float,
    ) -> PerformanceClockSnapshot:
        performance_elapsed_ms = self._performance_elapsed_ms(active_elapsed_ms)
        musical_beat = self._musical_beat(performance_elapsed_ms)
        return PerformanceClockSnapshot(
            state=state,
            now_ms=now_ms,
            musical_beat=musical_beat,
            performance_elapsed_ms=performance_elapsed_ms,
            count_in_remaining_ms=self._count_in_remaining_ms(active_elapsed_ms),
            count_in_remaining_pulses=self._count_in_remaining_pulses(active_elapsed_ms),
            scope_completed=state == PerformanceClockState.ENDED,
        )

    def _resolved_active_state(self, active_elapsed_ms: float) -> PerformanceClockState:
        if self._state == PerformanceClockState.PAUSED:
            return PerformanceClockState.PAUSED
        if active_elapsed_ms < self._count_in_ms:
            return PerformanceClockState.COUNT_IN
        if self._performance_elapsed_ms(active_elapsed_ms) >= self._scope.nominal_duration_ms:
            return PerformanceClockState.ENDED
        return PerformanceClockState.RUNNING

    def _active_elapsed_ms(self, now_ms: int) -> float:
        if self._started_at_ms is None:
            return 0.0
        pause_elapsed_ms = (
            max(0.0, now_ms - self._pause_started_at_ms)
            if self._state == PerformanceClockState.PAUSED and self._pause_started_at_ms is not None
            else 0.0
        )
        return max(0.0, now_ms - self._started_at_ms - self._paused_duration_ms - pause_elapsed_ms)

    def _performance_elapsed_ms(self, active_elapsed_ms: float) -> float:
        elapsed_after_count_in = max(0.0, active_elapsed_ms - self._count_in_ms)
        return min(
            elapsed_after_count_in * self._speed_ratio,
            self._scope.nominal_duration_ms,
        )

    def _musical_beat(self, performance_elapsed_ms: float) -> ScoreBeat:
        if performance_elapsed_ms >= self._scope.nominal_duration_ms:
            return self._scope.terminal_beat
        return self._timeline.time_ms_to_beat(
            self._scope.nominal_start_time_ms + performance_elapsed_ms
        )

    def _count_in_remaining_ms(self, active_elapsed_ms: float) -> float:
        return max(0.0, self._count_in_ms - active_elapsed_ms)

    def _count_in_remaining_pulses(self, active_elapsed_ms: float) -> float:
        if self._count_in_pulses <= 0 or self._count_in_ms <= 0:
            return 0.0
        remaining_ratio = self._count_in_remaining_ms(active_elapsed_ms) / self._count_in_ms
        return max(0.0, self._count_in_pulses * remaining_ratio)

    def _count_in_duration_ms(self, count_in_duration_beats: float) -> float:
        bpm = self._timeline.bpm_at_beat(self._scope.start_beat)
        return count_in_duration_beats * 60_000.0 / bpm / self._speed_ratio
