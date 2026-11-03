"""Public metadata and simple-repeat duration projections of written score facts."""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from fractions import Fraction
from typing import cast

from app.score_semantics.musicxml_score import (
    CanonicalScoreSemanticModel,
    MusicXMLSemanticError,
    parse_score_semantics,
)
from app.score_semantics.tempo_policy import DEFAULT_SCORE_TEMPO_BPM

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


def extract_musicxml_metadata(content: bytes | str) -> MusicXMLMetadata:
    try:
        model = parse_score_semantics(content)
    except MusicXMLSemanticError as error:
        raise MetadataExtractionError(str(error)) from error
    return project_score_metadata(model)


def project_score_metadata(model: CanonicalScoreSemanticModel) -> MusicXMLMetadata:
    # Public event lists retain part/written-source order and their existing DTO.
    key_events: list[dict[str, object]] = [
        {
            "part": key.part_index + 1,
            "measure": key.measure_number or str(key.measure_index + 1),
            "fifths": key.fifths,
            "mode": key.mode,
        }
        for key in sorted(model.keys, key=lambda k: (k.part_index, k.measure_index))
    ]
    time_events: list[dict[str, object]] = []
    for meter in sorted(model.meters, key=lambda m: (m.part_index, m.measure_index)):
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
    starts = [measure.start for measure in model.measures]
    durations = [measure.end - measure.start for measure in model.measures]
    playback_tempos: dict[int, list[tuple[Fraction, Fraction]]] = {}
    for position, bpm in sorted({t.position: t.quarter_bpm for t in model.tempos}.items()):
        index = min(bisect_right(starts, position) - 1, len(starts) - 1)
        playback_tempos.setdefault(index, []).append((position - starts[index], bpm))
    repeats = [(False, False, 2) for _ in model.measures]
    for repeat in model.repeats:
        if repeat.part_index == 0:
            forward, backward, times = repeats[repeat.measure_index]
            repeats[repeat.measure_index] = (
                forward or repeat.direction == "forward",
                backward or repeat.direction == "backward",
                repeat.times if repeat.direction == "backward" else times,
            )
    duration_ms = _playback_duration_ms(_playback_order(repeats), durations, playback_tempos)
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
    )


def _playback_order(repeats: list[tuple[bool, bool, int]]) -> list[int]:
    """Expand one-level barline repeats; unsupported nesting remains deterministic."""
    order: list[int] = []
    repeat_start = 0
    for index, (forward, backward, times) in enumerate(repeats):
        if forward:
            repeat_start = index
        order.append(index)
        if backward:
            for _ in range(max(1, times) - 1):
                order.extend(range(repeat_start, index + 1))
            repeat_start = index + 1
    return order


def _playback_duration_ms(
    order: list[int],
    durations: list[Fraction],
    tempos: dict[int, list[tuple[Fraction, Fraction]]],
) -> int:
    linear_start_tempos: list[Fraction] = []
    tempo = Fraction(DEFAULT_SCORE_TEMPO_BPM)
    for index in range(len(durations)):
        linear_start_tempos.append(tempo)
        events = tempos.get(index) or []
        if events:
            tempo = events[-1][1]

    total_seconds = Fraction(0)
    for index in order:
        measure_duration = durations[index]
        cursor = Fraction(0)
        tempo = linear_start_tempos[index]
        for offset, next_tempo in sorted(tempos.get(index) or []):
            bounded = min(max(offset, cursor), measure_duration)
            total_seconds += (bounded - cursor) * 60 / tempo
            cursor = bounded
            tempo = next_tempo
        total_seconds += max(Fraction(0), measure_duration - cursor) * 60 / tempo
    return round(total_seconds * 1000)
