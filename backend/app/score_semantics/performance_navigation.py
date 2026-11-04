"""Exact performance occurrences for linear and simple non-nested repeats.

Written facts remain immutable. This projection owns traversal and the mapping
from written positions to their occurrences, independently of product timing.
"""

from dataclasses import dataclass
from fractions import Fraction
from collections.abc import Sequence
from typing import TypeVar, Generic

from .musicxml_score import CanonicalScoreSemanticModel
from .written_point import WrittenPoint, WrittenPointError, resolve_written_point

T = TypeVar("T")


class PerformanceNavigationError(ValueError):
    pass


@dataclass(frozen=True)
class WrittenPerformanceFact(Generic[T]):
    point: WrittenPoint
    value: T


@dataclass(frozen=True)
class ProjectedPerformanceFact(Generic[T]):
    occurrence_ordinal: int
    position: Fraction
    source: WrittenPerformanceFact[T]

    @property
    def value(self) -> T:
        return self.source.value


@dataclass(frozen=True)
class PerformanceOccurrence:
    ordinal: int
    measure_index: int
    visit: int
    written_start: Fraction
    written_end: Fraction
    performance_start: Fraction
    performance_end: Fraction

    def project_position(self, position: Fraction) -> Fraction:
        if not self.written_start <= position <= self.written_end:
            raise PerformanceNavigationError("written_position_outside_occurrence")
        return self.performance_start + position - self.written_start


@dataclass(frozen=True)
class PerformanceProjection:
    occurrences: tuple[PerformanceOccurrence, ...]

    @property
    def end(self) -> Fraction:
        return self.occurrences[-1].performance_end

    def project_position(self, point: WrittenPoint) -> tuple[Fraction, ...]:
        return tuple(f.position for f in self.project_facts([WrittenPerformanceFact(point, None)]))

    def project_facts(
        self, facts: Sequence[WrittenPerformanceFact[T]]
    ) -> tuple[ProjectedPerformanceFact[T], ...]:
        """Encounter owned start/interior/end facts in traversal order.

        Stable sorting retains source ordering and duplicate values within a
        slot. Source endpoints precede destination starts at a jump. Every
        output retains its original written identity and occurrence identity.
        """
        spans_by_measure = {
            o.measure_index: (o.written_start, o.written_end) for o in self.occurrences
        }
        spans = [spans_by_measure[i] for i in range(len(spans_by_measure))]
        grouped: dict[int, list[WrittenPerformanceFact[T]]] = {}
        for fact in facts:
            try:
                owner = resolve_written_point(fact.point, spans)
            except WrittenPointError as error:
                raise PerformanceNavigationError(str(error)) from error
            grouped.setdefault(owner.measure_index, []).append(fact)
        return tuple(
            ProjectedPerformanceFact(
                occurrence.ordinal, occurrence.project_position(fact.point.position), fact
            )
            for occurrence in self.occurrences
            for fact in sorted(
                grouped.get(occurrence.measure_index, ()), key=lambda f: f.point.position
            )
        )


def project_performance_occurrences(model: CanonicalScoreSemanticModel) -> PerformanceProjection:
    if model.endings or model.sound_navigation or model.navigation_markers:
        raise PerformanceNavigationError("unsupported_performance_navigation")

    # An unannotated part has no opinion. Annotated parts must each provide the
    # same complete program; markers from different parts are never stitched.
    programs: dict[int, list[tuple[int, str, str, int | None, bool | None]]] = {}
    for repeat in model.repeats:
        programs.setdefault(repeat.part_index, []).append(
            (
                repeat.measure_index,
                repeat.location,
                repeat.direction,
                repeat.times,
                repeat.after_jump,
            )
        )
    normalized = [
        tuple(sorted(program, key=lambda f: (f[0], f[1], f[2]))) for program in programs.values()
    ]
    if any(program != normalized[0] for program in normalized[1:]):
        raise PerformanceNavigationError("conflicting_part_navigation")
    program = normalized[0] if normalized else ()
    boundaries: dict[tuple[int, str], tuple[int | None, bool | None]] = {}
    for index, location, direction, times, after_jump in program:
        if location != ("left" if direction == "forward" else "right") or after_jump is not None:
            raise PerformanceNavigationError("unsupported_performance_navigation")
        slot = (index, direction)
        if slot in boundaries:
            raise PerformanceNavigationError("ambiguous_repeat_boundary")
        boundaries[slot] = (times, after_jump)

    order: list[int] = []
    repeat_start: int | None = None
    closed_repeat = False
    for measure in model.measures:
        index = measure.index
        if (index, "forward") in boundaries:
            if repeat_start is not None:
                raise PerformanceNavigationError("unsupported_nested_repeat")
            repeat_start = index
        order.append(index)
        if (index, "backward") in boundaries:
            if repeat_start is None:
                if closed_repeat:
                    raise PerformanceNavigationError("ambiguous_implicit_repeat_start")
                repeat_start = 0
            times = boundaries[(index, "backward")][0]
            assert times is not None  # Written backward facts carry effective total plays.
            for _ in range(times - 1):
                order.extend(range(repeat_start, index + 1))
            repeat_start = None
            closed_repeat = True
    if repeat_start is not None:
        raise PerformanceNavigationError("unclosed_repeat")

    visits: dict[int, int] = {}
    cursor = Fraction(0)
    occurrences = []
    for ordinal, index in enumerate(order):
        measure = model.measures[index]
        visits[index] = visits.get(index, 0) + 1
        end = cursor + measure.end - measure.start
        occurrences.append(
            PerformanceOccurrence(
                ordinal, index, visits[index], measure.start, measure.end, cursor, end
            )
        )
        cursor = end
    return PerformanceProjection(tuple(occurrences))
