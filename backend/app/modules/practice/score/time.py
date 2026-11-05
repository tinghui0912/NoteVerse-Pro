"""Exact, source-local integer coordinates for Practice written score time."""

from collections.abc import Iterable
from dataclasses import dataclass
from fractions import Fraction
from math import lcm
from typing import TypeAlias

from .piano_key import PracticeScoreInvalidError

ScoreTick: TypeAlias = int
TicksPerQuarter: TypeAlias = int
MAX_JSON_SAFE_INTEGER = 2**53 - 1


def score_tick(value: object) -> ScoreTick:
    if type(value) is not int or not 0 <= value <= MAX_JSON_SAFE_INTEGER:
        raise PracticeScoreInvalidError(
            "Practice score ticks require nonnegative JSON-safe integers."
        )
    return value


def ticks_per_quarter(value: object) -> TicksPerQuarter:
    result = score_tick(value)
    if result == 0:
        raise PracticeScoreInvalidError("Practice ticksPerQuarter must be positive.")
    return result


@dataclass(frozen=True)
class PracticeScoreTimebase:
    ticks_per_quarter: TicksPerQuarter

    def __post_init__(self) -> None:
        ticks_per_quarter(self.ticks_per_quarter)

    @classmethod
    def derive(cls, values: Iterable[Fraction]) -> "PracticeScoreTimebase":
        required = tuple(values)
        resolution = 1
        for value in required:
            if not isinstance(value, Fraction) or value < 0:
                raise PracticeScoreInvalidError(
                    "Practice timebase requires exact nonnegative Fractions."
                )
            resolution = lcm(resolution, value.denominator)
            ticks_per_quarter(resolution)
        result = cls(resolution)
        for value in required:
            result.to_tick(value)
        return result

    def to_tick(self, value: Fraction) -> ScoreTick:
        if not isinstance(value, Fraction):
            raise PracticeScoreInvalidError("Practice score coordinates require exact Fractions.")
        scaled = value * self.ticks_per_quarter
        if scaled.denominator != 1:
            raise PracticeScoreInvalidError(
                "Practice score timebase cannot represent this coordinate exactly."
            )
        return score_tick(scaled.numerator)

    def meter_duration_ticks(self, numerator: int, denominator: int) -> ScoreTick:
        return self.to_tick(Fraction(numerator * 4, denominator))

    def meter_pulse_ticks(self, denominator: int) -> ScoreTick:
        return self.to_tick(Fraction(4, denominator))
