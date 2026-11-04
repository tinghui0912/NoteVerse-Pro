"""Stateless canonical document admission, compilation and transport projection."""

from app.core.exceptions import ValidationException
from app.processing.musicxml.admission import admit_musicxml_document
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_navigation import PerformanceNavigationError
from app.score_semantics.performance_plan import build_performance_plan
from app.shared.constants import ErrorCode

from .performance_plan_schemas import (
    PerformanceOccurrenceRead,
    PerformancePlanRead,
    PerformanceTempoEventRead,
    RationalRead,
)


def compile_performance_plan(musicxml: str) -> PerformancePlanRead:
    admitted = admit_musicxml_document(musicxml.encode("utf-8"))
    model = parse_score_semantics(admitted)
    try:
        plan = build_performance_plan(model)
    except PerformanceNavigationError as error:
        raise ValidationException(
            ErrorCode.SCORE_PLAYBACK_FAILED, details={"reason": str(error)}
        ) from error
    rational = RationalRead.from_fraction
    return PerformancePlanRead(
        musicxml=admitted.decode("utf-8"),
        performance_end=rational(plan.projection.end),
        initial_tempo_bpm=rational(plan.initial_tempo_bpm),
        occurrences=[
            PerformanceOccurrenceRead(
                ordinal=o.ordinal,
                measure_index=o.measure_index,
                visit=o.visit,
                written_start=rational(o.written_start),
                written_end=rational(o.written_end),
                performance_start=rational(o.performance_start),
                performance_end=rational(o.performance_end),
            )
            for o in plan.projection.occurrences
        ],
        tempo_events=[
            PerformanceTempoEventRead(
                occurrence_ordinal=t.occurrence_ordinal,
                performance_position=rational(t.performance_position),
                bpm=rational(t.bpm),
            )
            for t in plan.tempo_events
        ],
    )
