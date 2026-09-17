from __future__ import annotations

from dataclasses import dataclass

from app.processing.engines.practice_alignment.score_timeline import (
    PracticeScoreTimeline,
    ScoreBeat,
)


DEFAULT_PERFORMANCE_TEMPO_BPM = 120.0


class PerformanceTimelineError(ValueError):
    pass


class PerformanceScopeTargetNotFound(PerformanceTimelineError):
    def __init__(self, group_id: str) -> None:
        super().__init__(f"Practice scope target not found: {group_id}")
        self.group_id = group_id


class PerformanceScopeInvalidRange(PerformanceTimelineError):
    pass


@dataclass(frozen=True)
class TempoSegment:
    start_beat: ScoreBeat
    bpm: float


@dataclass(frozen=True)
class PerformanceTimelineSegment:
    start_beat: ScoreBeat
    end_beat: ScoreBeat
    start_time_ms: float
    bpm: float

    @property
    def end_time_ms(self) -> float:
        return self.start_time_ms + _beats_to_ms(self.end_beat - self.start_beat, self.bpm)


@dataclass(frozen=True)
class PerformanceTimelineProjectionSegment:
    start_performance_time_ms: float
    end_performance_time_ms: float
    start_beat: ScoreBeat
    end_beat: ScoreBeat


@dataclass(frozen=True)
class PerformanceTimelineProjection:
    scope_start_beat: ScoreBeat
    scope_terminal_beat: ScoreBeat
    segments: tuple[PerformanceTimelineProjectionSegment, ...]


@dataclass(frozen=True)
class ResolvedPerformanceScope:
    start_group_id: str | None
    end_group_id: str | None
    start_beat: ScoreBeat
    terminal_beat: ScoreBeat
    nominal_start_time_ms: float
    nominal_end_time_ms: float

    @property
    def nominal_duration_ms(self) -> float:
        return max(0.0, self.nominal_end_time_ms - self.nominal_start_time_ms)


@dataclass(frozen=True)
class PerformanceTimeline:
    end_beat: ScoreBeat
    segments: tuple[PerformanceTimelineSegment, ...]

    @classmethod
    def from_score_timeline(
        cls,
        score_timeline: PracticeScoreTimeline,
        tempo_segments: tuple[TempoSegment, ...] = (),
    ) -> "PerformanceTimeline":
        end_beat = _round_beat(score_timeline.end_beat)
        if end_beat <= 0:
            return cls(end_beat=0.0, segments=())

        normalized_tempos = _normalized_tempo_segments(tempo_segments)
        segments: list[PerformanceTimelineSegment] = []
        current_time_ms = 0.0
        for index, tempo in enumerate(normalized_tempos):
            next_start = (
                normalized_tempos[index + 1].start_beat
                if index + 1 < len(normalized_tempos)
                else end_beat
            )
            segment_start = min(max(tempo.start_beat, 0.0), end_beat)
            segment_end = min(max(next_start, segment_start), end_beat)
            if segment_end <= segment_start:
                continue
            segment = PerformanceTimelineSegment(
                start_beat=_round_beat(segment_start),
                end_beat=_round_beat(segment_end),
                start_time_ms=current_time_ms,
                bpm=tempo.bpm,
            )
            segments.append(segment)
            current_time_ms = segment.end_time_ms

        return cls(end_beat=end_beat, segments=tuple(segments))

    @property
    def nominal_duration_ms(self) -> float:
        if not self.segments:
            return 0.0
        return self.segments[-1].end_time_ms

    def beat_to_time_ms(self, beat: ScoreBeat) -> float:
        if not self.segments:
            return 0.0
        bounded = min(max(float(beat), 0.0), self.end_beat)
        segment = self._segment_for_beat(bounded)
        return segment.start_time_ms + _beats_to_ms(bounded - segment.start_beat, segment.bpm)

    def time_ms_to_beat(self, time_ms: float) -> ScoreBeat:
        if not self.segments:
            return 0.0
        bounded = min(max(float(time_ms), 0.0), self.nominal_duration_ms)
        segment = self._segment_for_time_ms(bounded)
        elapsed_ms = bounded - segment.start_time_ms
        return _round_beat(segment.start_beat + _ms_to_beats(elapsed_ms, segment.bpm))

    def bpm_at_beat(self, beat: ScoreBeat) -> float:
        if not self.segments:
            return DEFAULT_PERFORMANCE_TEMPO_BPM
        bounded = min(max(float(beat), 0.0), self.end_beat)
        return self._segment_for_beat(bounded).bpm

    def projection_for_scope(
        self,
        scope: ResolvedPerformanceScope,
    ) -> PerformanceTimelineProjection:
        if scope.nominal_duration_ms <= 0:
            return PerformanceTimelineProjection(
                scope_start_beat=scope.start_beat,
                scope_terminal_beat=scope.terminal_beat,
                segments=(),
            )

        projection_segments: list[PerformanceTimelineProjectionSegment] = []
        for segment in self.segments:
            start_beat = max(segment.start_beat, scope.start_beat)
            end_beat = min(segment.end_beat, scope.terminal_beat)
            if end_beat <= start_beat:
                continue
            start_time_ms = self.beat_to_time_ms(start_beat) - scope.nominal_start_time_ms
            end_time_ms = self.beat_to_time_ms(end_beat) - scope.nominal_start_time_ms
            projection_segments.append(
                PerformanceTimelineProjectionSegment(
                    start_performance_time_ms=max(0.0, start_time_ms),
                    end_performance_time_ms=min(scope.nominal_duration_ms, end_time_ms),
                    start_beat=_round_beat(start_beat),
                    end_beat=_round_beat(end_beat),
                )
            )

        return PerformanceTimelineProjection(
            scope_start_beat=scope.start_beat,
            scope_terminal_beat=scope.terminal_beat,
            segments=tuple(projection_segments),
        )

    def resolve_scope(
        self,
        score_timeline: PracticeScoreTimeline,
        *,
        start_expected_group_id: str | None = None,
        end_expected_group_id: str | None = None,
    ) -> ResolvedPerformanceScope:
        expected_groups = score_timeline.expected_practice_groups
        if not expected_groups:
            raise PerformanceScopeInvalidRange("Performance scope requires playable groups.")

        start_index = _group_index(expected_groups, start_expected_group_id) if start_expected_group_id else 0
        end_index = (
            _group_index(expected_groups, end_expected_group_id)
            if end_expected_group_id
            else len(expected_groups) - 1
        )
        if end_index < start_index:
            raise PerformanceScopeInvalidRange(
                "Performance scope end target must not be before the start target."
            )

        start_group = expected_groups[start_index]
        end_group = expected_groups[end_index]
        if end_expected_group_id is None:
            terminal_beat = score_timeline.end_beat
        else:
            terminal_candidate = score_timeline.entry_group_end_beat(end_group.group_id)
            if terminal_candidate is None:
                raise PerformanceScopeTargetNotFound(end_group.group_id)
            terminal_beat = terminal_candidate
        terminal_beat = min(_round_beat(terminal_beat), self.end_beat)
        start_beat = _round_beat(start_group.onset_beat)
        if terminal_beat < start_beat:
            raise PerformanceScopeInvalidRange(
                "Performance scope terminal beat must not be before its start beat."
            )

        return ResolvedPerformanceScope(
            start_group_id=start_group.group_id if start_expected_group_id else None,
            end_group_id=end_group.group_id if end_expected_group_id else None,
            start_beat=start_beat,
            terminal_beat=terminal_beat,
            nominal_start_time_ms=self.beat_to_time_ms(start_beat),
            nominal_end_time_ms=self.beat_to_time_ms(terminal_beat),
        )

    def _segment_for_beat(self, beat: ScoreBeat) -> PerformanceTimelineSegment:
        for segment in self.segments:
            if segment.start_beat <= beat < segment.end_beat:
                return segment
        return self.segments[-1]

    def _segment_for_time_ms(self, time_ms: float) -> PerformanceTimelineSegment:
        for segment in self.segments:
            if segment.start_time_ms <= time_ms < segment.end_time_ms:
                return segment
        return self.segments[-1]


def _normalized_tempo_segments(tempo_segments: tuple[TempoSegment, ...]) -> tuple[TempoSegment, ...]:
    valid_segments = sorted(tempo_segments or (), key=lambda segment: segment.start_beat)
    for segment in valid_segments:
        if segment.bpm <= 0:
            raise PerformanceTimelineError("Tempo BPM must be positive.")

    merged: dict[ScoreBeat, TempoSegment] = {
        _round_beat(segment.start_beat): TempoSegment(_round_beat(segment.start_beat), segment.bpm)
        for segment in valid_segments
        if segment.start_beat >= 0
    }
    merged.setdefault(0.0, TempoSegment(0.0, DEFAULT_PERFORMANCE_TEMPO_BPM))
    return tuple(merged[beat] for beat in sorted(merged))


def _group_index(expected_groups, expected_group_id: str) -> int:
    for index, group in enumerate(expected_groups):
        if group.group_id == expected_group_id:
            return index
    raise PerformanceScopeTargetNotFound(expected_group_id)


def _beats_to_ms(beats: float, bpm: float) -> float:
    return beats * 60_000.0 / bpm


def _ms_to_beats(milliseconds: float, bpm: float) -> float:
    return milliseconds * bpm / 60_000.0


def _round_beat(value: float) -> ScoreBeat:
    return round(value, 6)
