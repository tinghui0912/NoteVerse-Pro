"""Integrate exact plan tempo encounters for performance regression assertions."""

from fractions import Fraction

from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_plan import build_performance_plan


def performed_duration_ms(content: bytes | str) -> int:
    plan = build_performance_plan(parse_score_semantics(content))
    tempo = plan.initial_tempo_bpm
    cursor = Fraction(0)
    total_seconds = Fraction(0)
    for fact in plan.tempo_events:
        position, next_tempo = fact.performance_position, fact.bpm
        total_seconds += (position - cursor) * 60 / tempo
        cursor = position
        tempo = next_tempo
    total_seconds += (plan.projection.end - cursor) * 60 / tempo
    return round(total_seconds * 1000)
