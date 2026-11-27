"""Written fact coordinates retain the source measure's boundary ownership."""

from collections.abc import Sequence
from dataclasses import dataclass
from fractions import Fraction


class WrittenPointError(ValueError):
    pass


class AmbiguousWrittenPointError(WrittenPointError):
    pass


@dataclass(frozen=True)
class WrittenPoint:
    measure_index: int
    position: Fraction


def resolve_written_point(
    point: WrittenPoint, spans: Sequence[tuple[Fraction, Fraction]]
) -> WrittenPoint:
    """Preserve own endpoints; cross-measure interiors have one destination.

    An offset outside its source measure landing on a shared boundary does not
    identify either navigation side. Consumers requiring traversal reject it.
    """
    if not 0 <= point.measure_index < len(spans):
        raise WrittenPointError("invalid_written_measure")
    start, end = spans[point.measure_index]
    if start <= point.position <= end:
        return point
    if point.position < spans[0][0] or point.position > spans[-1][1]:
        raise WrittenPointError("written_position_outside_score")
    if point.position == spans[0][0]:
        return WrittenPoint(0, point.position)
    if point.position == spans[-1][1]:
        return WrittenPoint(len(spans) - 1, point.position)
    for index, (start, end) in enumerate(spans):
        if start < point.position < end:
            return WrittenPoint(index, point.position)
    raise AmbiguousWrittenPointError("ambiguous_cross_measure_boundary")
