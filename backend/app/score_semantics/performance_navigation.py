"""Exact performance intervals for supported written navigation programs.

Written facts remain immutable. This projection owns traversal and the mapping
from written positions to their occurrences, independently of product timing.
"""

from dataclasses import dataclass, field
from fractions import Fraction
from collections.abc import Sequence
from typing import TypeVar, Generic

from .musicxml_score import CanonicalScoreSemanticModel, WrittenEnding
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
    """One contiguous visit inside a written measure, including required point visits."""

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
    written_spans: tuple[tuple[Fraction, Fraction], ...]

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
        grouped: dict[int, list[WrittenPerformanceFact[T]]] = {}
        for fact in facts:
            try:
                owner = resolve_written_point(fact.point, self.written_spans)
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
            if occurrence.written_start <= fact.point.position <= occurrence.written_end
        )


@dataclass(frozen=True)
class EndingSpan:
    start_measure_index: int
    end_measure_index: int
    passes: tuple[int, ...]
    # stop/discontinue differ in engraving, not in performance selection.
    close_type: str = field(compare=False)


@dataclass(frozen=True)
class _RepeatContext:
    start: int
    end: int
    total_plays: int
    repeat_back: EndingSpan | None = None
    final_exit: EndingSpan | None = None

    @property
    def continuation(self) -> int:
        return (self.final_exit.end_measure_index if self.final_exit else self.end) + 1


def _normalize_ending_spans(markers: Sequence[WrittenEnding]) -> tuple[EndingSpan, ...]:
    spans = []
    active: WrittenEnding | None = None
    for marker in sorted(markers, key=lambda e: (e.measure_index, e.type != "start")):
        if marker.location != ("left" if marker.type == "start" else "right"):
            raise PerformanceNavigationError("unsupported_ending_boundary")
        if marker.passes is None:
            raise PerformanceNavigationError("unknown_ending_passes")
        if marker.type == "start":
            if active is not None:
                raise PerformanceNavigationError("overlapping_ending_spans")
            active = marker
        else:
            if active is None:
                raise PerformanceNavigationError("ending_close_without_start")
            if active.passes != marker.passes:
                raise PerformanceNavigationError("conflicting_ending_passes")
            spans.append(
                EndingSpan(active.measure_index, marker.measure_index, marker.passes, marker.type)
            )
            active = None
    if active is not None:
        raise PerformanceNavigationError("unclosed_ending_span")
    return tuple(spans)


def _associate_endings(
    repeat_ranges: Sequence[tuple[int, int, int | None]], spans: Sequence[EndingSpan]
) -> tuple[_RepeatContext, ...]:
    associated = []
    span_index = 0
    previous_end = -1
    for start, end, times in repeat_ranges:
        if start <= previous_end:
            raise PerformanceNavigationError("overlapping_repeat_contexts")
        if span_index < len(spans) and spans[span_index].start_measure_index <= end:
            back = spans[span_index]
            final = spans[span_index + 1] if span_index + 1 < len(spans) else None
            if (
                back.start_measure_index < start
                or back.end_measure_index != end
                or final is None
                or final.start_measure_index != end + 1
                or len(final.passes) != 1
                or final.passes[0] < 2
                or back.passes != tuple(range(1, final.passes[0]))
            ):
                raise PerformanceNavigationError("unsupported_ending_group")
            if times is not None:
                raise PerformanceNavigationError("repeat_times_with_ending")
            context = _RepeatContext(start, end, final.passes[0], back, final)
            span_index += 2
        else:
            context = _RepeatContext(start, end, times if times is not None else 2)
        associated.append(context)
        previous_end = context.continuation - 1
    if span_index != len(spans):
        raise PerformanceNavigationError("unassociated_ending_span")
    return tuple(associated)


@dataclass(frozen=True)
class _NavigationFact:
    kind: str
    point: WrittenPoint
    value: str


@dataclass(frozen=True)
class _CodaTransfer:
    source: WrittenPoint
    target: WrittenPoint


@dataclass(frozen=True)
class _JumpProgram:
    source: WrittenPoint
    target: WrittenPoint
    fine: WrittenPoint | None
    tocoda: _CodaTransfer | None


def _point_order(point: WrittenPoint) -> tuple[int, Fraction]:
    return point.measure_index, point.position


def _compile_jump_program(
    model: CanonicalScoreSemanticModel, spans: Sequence[tuple[Fraction, Fraction]]
) -> _JumpProgram | None:
    has_primary = any(f.dacapo or f.dalsegno is not None for f in model.playback_navigation)
    has_tocoda = any(f.tocoda is not None for f in model.playback_navigation)
    if has_primary and (model.repeats or model.endings):
        raise PerformanceNavigationError("unsupported_jump_repeat_interaction")
    programs: dict[int, set[_NavigationFact]] = {}
    for event in model.playback_navigation:
        roles = [
            (kind, value)
            for kind, value in (
                ("dacapo", "yes" if event.dacapo else None),
                ("dalsegno", event.dalsegno),
                ("fine", event.fine),
                ("tocoda", event.tocoda),
                ("forward-repeat", "yes" if event.forward_repeat else None),
            )
            if value is not None
        ]
        if len(roles) > 1:
            raise PerformanceNavigationError("unsupported_compound_navigation_event")
        if event.forward_repeat:
            raise PerformanceNavigationError("unsupported_performance_navigation")
        if event.fine is not None and has_tocoda:
            raise PerformanceNavigationError("unsupported_fine_coda_combination")
        if event.fine is not None and event.fine != "yes":
            raise PerformanceNavigationError("unsupported_numeric_fine_duration")
        if roles and roles[0][0] in {"dacapo", "dalsegno"}:
            if event.time_only not in (None, (1,)):
                raise PerformanceNavigationError("unsupported_jump_time_only")
        elif event.tocoda is not None:
            if event.time_only not in (None, (2,)):
                raise PerformanceNavigationError("unsupported_tocoda_time_only")
        elif event.fine is not None:
            if event.time_only not in (None, (2,)):
                raise PerformanceNavigationError("unsupported_fine_time_only")
        if (
            has_primary
            and event.time_only is not None
            and (event.segno is not None or event.coda is not None)
        ):
            raise PerformanceNavigationError("unsupported_destination_time_only")
        if not has_primary:
            if event.tocoda is not None:
                raise PerformanceNavigationError("unsupported_orphan_tocoda")
            if event.fine is not None:
                raise PerformanceNavigationError("unsupported_orphan_fine")
            # Destinations without commands do not alter traversal or need resolution.
            continue
        try:
            point = resolve_written_point(event.point, spans)
        except WrittenPointError as error:
            raise PerformanceNavigationError(str(error)) from error
        program = programs.setdefault(event.part_index, set())
        for kind, value in roles:
            program.add(_NavigationFact(kind, point, value))
        for destination_kind, label in (("segno", event.segno), ("coda", event.coda)):
            if label is not None:
                program.add(_NavigationFact(destination_kind, point, label))
    if not has_primary:
        return None
    normalized = list(programs.values())
    if any(program != normalized[0] for program in normalized[1:]):
        raise PerformanceNavigationError("conflicting_part_navigation")
    facts = normalized[0]
    primary = [f for f in facts if f.kind in {"dacapo", "dalsegno"}]
    if len(primary) != 1:
        raise PerformanceNavigationError("unsupported_multiple_primary_jumps")
    fines = [f.point for f in facts if f.kind == "fine"]
    if len(fines) > 1:
        raise PerformanceNavigationError("unsupported_multiple_fines")
    codas = [f for f in facts if f.kind == "tocoda"]
    if len(codas) > 1:
        raise PerformanceNavigationError("unsupported_multiple_tocoda")
    command = primary[0]
    if command.kind == "dacapo":
        target = WrittenPoint(0, model.measures[0].start)
        if command.point.position <= target.position:
            raise PerformanceNavigationError("non_progressing_dacapo")
    else:
        destinations = {f.point for f in facts if f.kind == "segno" and f.value == command.value}
        if not destinations:
            raise PerformanceNavigationError("unresolved_jump_destination")
        if len(destinations) != 1:
            raise PerformanceNavigationError("ambiguous_jump_destination")
        target = next(iter(destinations))
        if target.position == command.point.position:
            raise PerformanceNavigationError("non_progressing_dalsegno")
        if target.position > command.point.position:
            raise PerformanceNavigationError("unsupported_non_backward_dalsegno")
    coda_transfer = None
    if codas:
        tocoda = codas[0]
        destinations = {f.point for f in facts if f.kind == "coda" and f.value == tocoda.value}
        if not destinations:
            raise PerformanceNavigationError("unresolved_coda_destination")
        if len(destinations) != 1:
            raise PerformanceNavigationError("ambiguous_coda_destination")
        coda_target = next(iter(destinations))
        if coda_target.position == tocoda.point.position:
            raise PerformanceNavigationError("non_progressing_tocoda")
        if _point_order(coda_target) < _point_order(tocoda.point):
            raise PerformanceNavigationError("unsupported_non_forward_tocoda")
        if _point_order(tocoda.point) < _point_order(target):
            raise PerformanceNavigationError("unreachable_tocoda_after_primary_jump")
        coda_transfer = _CodaTransfer(tocoda.point, coda_target)
    return _JumpProgram(command.point, target, fines[0] if fines else None, coda_transfer)


def _written_intervals(
    model: CanonicalScoreSemanticModel, entry: WrittenPoint, exit: WrittenPoint
) -> list[tuple[int, Fraction, Fraction]]:
    # Inclusive owned endpoints create a point visit only at an actual entry/exit.
    return [
        (
            index,
            entry.position if index == entry.measure_index else model.measures[index].start,
            exit.position if index == exit.measure_index else model.measures[index].end,
        )
        for index in range(entry.measure_index, exit.measure_index + 1)
    ]


def _repeat_measure_order(model: CanonicalScoreSemanticModel) -> list[int]:
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
    for ending in model.endings:
        programs.setdefault(ending.part_index, [])
    normalized = [
        (
            tuple(sorted(program, key=lambda f: (f[0], f[1], f[2]))),
            _normalize_ending_spans([e for e in model.endings if e.part_index == part_index]),
        )
        for part_index, program in programs.items()
    ]
    if any(program != normalized[0] for program in normalized[1:]):
        raise PerformanceNavigationError("conflicting_part_navigation")
    program, ending_spans = normalized[0] if normalized else ((), ())
    boundaries: dict[tuple[int, str], tuple[int | None, bool | None]] = {}
    for index, location, direction, times, after_jump in program:
        if location != ("left" if direction == "forward" else "right") or after_jump is not None:
            raise PerformanceNavigationError("unsupported_performance_navigation")
        slot = (index, direction)
        if slot in boundaries:
            raise PerformanceNavigationError("ambiguous_repeat_boundary")
        boundaries[slot] = (times, after_jump)

    repeat_ranges = []
    repeat_start: int | None = None
    closed_repeat = False
    for measure in model.measures:
        index = measure.index
        if (index, "forward") in boundaries:
            if repeat_start is not None:
                raise PerformanceNavigationError("unsupported_nested_repeat")
            repeat_start = index
        if (index, "backward") in boundaries:
            if repeat_start is None:
                if closed_repeat:
                    raise PerformanceNavigationError("ambiguous_implicit_repeat_start")
                repeat_start = 0
            times = boundaries[(index, "backward")][0]
            repeat_ranges.append((repeat_start, index, times))
            repeat_start = None
            closed_repeat = True
    if repeat_start is not None:
        raise PerformanceNavigationError("unclosed_repeat")

    by_start = {c.start: c for c in _associate_endings(repeat_ranges, ending_spans)}
    order: list[int] = []
    index = 0
    while index < len(model.measures):
        context = by_start.get(index)
        if context is None:
            order.append(index)
            index += 1
            continue
        for current_pass in range(1, context.total_plays + 1):
            if context.repeat_back is None:
                order.extend(range(context.start, context.end + 1))
            else:
                order.extend(range(context.start, context.repeat_back.start_measure_index))
                branch = (
                    context.repeat_back
                    if current_pass < context.total_plays
                    else context.final_exit
                )
                assert branch is not None
                order.extend(range(branch.start_measure_index, branch.end_measure_index + 1))
        index = context.continuation

    return order


def project_performance_occurrences(model: CanonicalScoreSemanticModel) -> PerformanceProjection:
    if any(tempo.time_only is not None for tempo in model.tempos):
        raise PerformanceNavigationError("unsupported_time_only_playback")
    spans = tuple((m.start, m.end) for m in model.measures)
    jump = _compile_jump_program(model, spans)
    if jump is None:
        intervals = [(index, *spans[index]) for index in _repeat_measure_order(model)]
    else:
        origin = WrittenPoint(0, model.measures[0].start)
        end = WrittenPoint(len(model.measures) - 1, model.end)
        # Primary fires once on leg one. Only the supported post-primary transfer
        # or armed Fine can end leg two. A Coda leg cannot transfer again.
        intervals = _written_intervals(model, origin, jump.source)
        if jump.tocoda is not None:
            intervals.extend(_written_intervals(model, jump.target, jump.tocoda.source))
            intervals.extend(_written_intervals(model, jump.tocoda.target, end))
        else:
            stop = (
                jump.fine
                if jump.fine is not None and _point_order(jump.fine) >= _point_order(jump.target)
                else end
            )
            intervals.extend(_written_intervals(model, jump.target, stop))
    visits: dict[int, int] = {}
    cursor = Fraction(0)
    occurrences = []
    for ordinal, (index, written_start, written_end) in enumerate(intervals):
        visits[index] = visits.get(index, 0) + 1
        performance_end = cursor + written_end - written_start
        occurrences.append(
            PerformanceOccurrence(
                ordinal, index, visits[index], written_start, written_end, cursor, performance_end
            )
        )
        cursor = performance_end
    return PerformanceProjection(tuple(occurrences), spans)
