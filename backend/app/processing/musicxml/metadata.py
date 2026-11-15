"""Public written metadata and exact canonical performance-plan duration."""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import cast

from app.score_semantics.musicxml_score import (
    CanonicalScoreSemanticModel,
    MusicXMLSemanticError,
    parse_score_semantics,
)
from app.score_semantics.performance_navigation import (
    PerformanceNavigationError,
)
from app.score_semantics.performance_plan import CanonicalPerformancePlan, build_performance_plan
from app.processing.musicxml.notation_title import extract_notation_title

EXTRACTOR_VERSION = "musicxml-metadata-v1"


class MetadataExtractionError(ValueError):
    pass


@dataclass(frozen=True)
class MusicXMLMetadata:
    measure_count: int
    playback_duration_ms: int
    part_count: int
    primary_key_fifths: int | None
    primary_mode: str | None
    key_signature_events: list[dict[str, object]]
    time_signature_events: list[dict[str, object]]
    tempo_events: list[dict[str, object]]
    extractor_version: str = EXTRACTOR_VERSION
    notation_title: str | None = None


def extract_musicxml_metadata(content: bytes | str) -> MusicXMLMetadata:
    try:
        model = parse_score_semantics(content)
    except MusicXMLSemanticError as error:
        raise MetadataExtractionError(str(error)) from error
    return project_score_metadata(model, notation_title=extract_notation_title(content))


def project_score_metadata(
    model: CanonicalScoreSemanticModel, *, notation_title: str | None = None
) -> MusicXMLMetadata:
    # Public event lists retain part/written-source order and their existing DTO.
    key_events: list[dict[str, object]] = []
    for key in sorted(model.keys, key=lambda k: (k.part_index, k.measure_index)):
        if key.staff_number is not None:
            raise MetadataExtractionError("unsupported_staff_key")
        if key.fifths is None:
            raise MetadataExtractionError("unsupported_nontraditional_key")
        key_events.append(
            {
                "part": key.part_index + 1,
                "measure": key.measure_number or str(key.measure_index + 1),
                "fifths": key.fifths,
                "mode": key.mode if key.mode is not None else "major",
            }
        )
    time_events: list[dict[str, object]] = []
    for meter in sorted(model.meters, key=lambda m: (m.part_index, m.measure_index)):
        if meter.staff_number is not None:
            raise MetadataExtractionError("unsupported_staff_meter")
        if len(meter.groups) != 1 or len(meter.groups[0][0]) != 1:
            raise MetadataExtractionError("invalid_time_beats")
        beats, denominator = meter.groups[0]
        time_events.append(
            {
                "part": meter.part_index + 1,
                "measure": meter.measure_number or str(meter.measure_index + 1),
                "beats": beats[0],
                "beat_type": denominator,
            }
        )
    tempo_events: list[dict[str, object]] = [
        {
            "part": tempo.part_index + 1,
            "measure": tempo.measure_number or str(tempo.measure_index + 1),
            "offset_quarters": round(
                float(tempo.position - model.measures[tempo.measure_index].start), 6
            ),
            "bpm": float(tempo.quarter_bpm),
        }
        for tempo in sorted(model.tempos, key=lambda t: (t.part_index, t.measure_index))
    ]
    try:
        plan = build_performance_plan(model)
    except PerformanceNavigationError as error:
        raise MetadataExtractionError(str(error)) from error
    duration_ms = _playback_duration_ms(plan)
    primary_key = next((event for event in key_events if event["part"] == 1), None)
    return MusicXMLMetadata(
        len(model.measures),
        duration_ms,
        len(model.parts),
        cast(int, primary_key["fifths"]) if primary_key else None,
        str(primary_key["mode"]) if primary_key else None,
        key_events,
        time_events,
        tempo_events,
        notation_title=notation_title,
    )


def _playback_duration_ms(plan: CanonicalPerformancePlan) -> int:
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
