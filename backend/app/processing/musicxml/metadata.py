from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from fractions import Fraction
import math
from typing import cast
import xml.etree.ElementTree as ET

from app.score_semantics.musicxml_tempo import (
    MusicXMLTempoError,
    parse_tempo_directive,
    put_tempo_fact,
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
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise MetadataExtractionError("invalid_xml") from exc
    if _name(root) not in {"score-partwise", "score-timewise"}:
        raise MetadataExtractionError("unsupported_root")

    parts = [element for element in root if _name(element) == "part"]
    if not parts:
        raise MetadataExtractionError("missing_parts")
    measures_by_part = [
        [element for element in part if _name(element) == "measure"] for part in parts
    ]
    measure_count = max((len(measures) for measures in measures_by_part), default=0)
    if measure_count == 0:
        raise MetadataExtractionError("missing_measures")

    key_events: list[dict[str, object]] = []
    time_events: list[dict[str, object]] = []
    tempo_events: list[dict[str, object]] = []
    measure_durations = [Fraction(0)] * measure_count
    directives: list[tuple[int, int, str, Fraction, Fraction]] = []
    first_part_repeats: list[tuple[bool, bool, int]] = []

    for part_index, measures in enumerate(measures_by_part):
        divisions = 1
        tempo_divisions = None
        for measure_index, measure in enumerate(measures):
            measure_number = measure.get("number") or str(measure_index + 1)
            cursor = Fraction(0)
            maximum = Fraction(0)
            for child in measure:
                child_name = _name(child)
                if child_name == "attributes":
                    divisions_node = _child(child, "divisions")
                    if divisions_node is not None and divisions_node.text:
                        divisions = _positive_int(divisions_node.text, "invalid_divisions")
                        tempo_divisions = Fraction(divisions)
                    for key in _children(child, "key"):
                        fifths = _required_int(_text(key, "fifths"), "invalid_key_fifths")
                        mode = (_text(key, "mode") or "major").strip().lower()
                        key_events.append(
                            {
                                "part": part_index + 1,
                                "measure": measure_number,
                                "fifths": fifths,
                                "mode": mode,
                            }
                        )
                    for time in _children(child, "time"):
                        beats = _positive_int(_text(time, "beats"), "invalid_time_beats")
                        beat_type = _positive_int(
                            _text(time, "beat-type"), "invalid_time_beat_type"
                        )
                        time_events.append(
                            {
                                "part": part_index + 1,
                                "measure": measure_number,
                                "beats": beats,
                                "beat_type": beat_type,
                            }
                        )
                elif child_name in {"direction", "sound"}:
                    try:
                        directive = parse_tempo_directive(child, tempo_divisions)
                    except MusicXMLTempoError as error:
                        raise MetadataExtractionError("invalid_tempo") from error
                    if directive is not None:
                        directives.append(
                            (
                                part_index,
                                measure_index,
                                measure_number,
                                cursor + directive.offset_quarters,
                                directive.quarter_bpm,
                            )
                        )
                elif child_name == "backup":
                    cursor = max(Fraction(0), cursor - _duration(child, divisions))
                elif child_name == "forward":
                    cursor += _duration(child, divisions)
                    maximum = max(maximum, cursor)
                elif child_name == "note":
                    duration = _duration(child, divisions)
                    if _child(child, "chord") is None:
                        cursor += duration
                        maximum = max(maximum, cursor)
            measure_durations[measure_index] = max(measure_durations[measure_index], maximum)
            if part_index == 0:
                first_part_repeats.append(_repeat_markers(measure))

    starts = [Fraction(0)]
    for duration in measure_durations:
        starts.append(starts[-1] + duration)
    facts: dict[Fraction, Fraction] = {}
    for part_index, measure_index, measure_number, offset, bpm in directives:
        position = starts[measure_index] + offset
        try:
            put_tempo_fact(facts, position, bpm)
        except MusicXMLTempoError as error:
            raise MetadataExtractionError("invalid_tempo") from error
        if position > starts[-1]:
            raise MetadataExtractionError("invalid_tempo_position")
        tempo_events.append(
            {
                "part": part_index + 1,
                "measure": measure_number,
                "offset_quarters": round(float(offset), 6),
                "bpm": float(bpm),
            }
        )
    playback_tempos: dict[int, list[tuple[Fraction, Fraction]]] = {}
    for position, bpm in sorted(facts.items()):
        index = min(bisect_right(starts, position) - 1, measure_count - 1)
        playback_tempos.setdefault(index, []).append((position - starts[index], bpm))
    order = _playback_order(first_part_repeats)
    duration_ms = _playback_duration_ms(order, measure_durations, playback_tempos)
    primary_key = next((event for event in key_events if event["part"] == 1), None)
    return MusicXMLMetadata(
        measure_count=measure_count,
        playback_duration_ms=duration_ms,
        part_count=len(parts),
        primary_key_fifths=(cast(int, primary_key["fifths"]) if primary_key else None),
        primary_mode=(str(primary_key["mode"]) if primary_key else None),
        key_signature_events=key_events,
        time_signature_events=time_events,
        tempo_events=tempo_events,
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


def _repeat_markers(measure: ET.Element) -> tuple[bool, bool, int]:
    forward = False
    backward = False
    times = 2
    for barline in _children(measure, "barline"):
        repeat = _child(barline, "repeat")
        if repeat is None:
            continue
        direction = repeat.get("direction")
        forward = forward or direction == "forward"
        backward = backward or direction == "backward"
        if direction == "backward" and repeat.get("times"):
            times = _positive_int(repeat.get("times"), "invalid_repeat_times")
    return forward, backward, times


def _duration(element: ET.Element, divisions: int) -> Fraction:
    value = _text(element, "duration")
    if value is None:
        return Fraction(0)
    _positive_float(value, "invalid_duration", allow_zero=True)
    return Fraction(value) / divisions


def _positive_int(value: str | None, code: str) -> int:
    parsed = _required_int(value, code)
    if parsed <= 0:
        raise MetadataExtractionError(code)
    return parsed


def _required_int(value: str | None, code: str) -> int:
    try:
        return int(value or "")
    except ValueError as exc:
        raise MetadataExtractionError(code) from exc


def _positive_float(value: str | None, code: str, *, allow_zero: bool = False) -> float:
    try:
        parsed = float(value or "")
    except ValueError as exc:
        raise MetadataExtractionError(code) from exc
    if not math.isfinite(parsed) or parsed < 0 or (parsed == 0 and not allow_zero):
        raise MetadataExtractionError(code)
    return parsed


def _name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if _name(child) == name]


def _child(element: ET.Element, name: str) -> ET.Element | None:
    return next((child for child in element if _name(child) == name), None)


def _text(element: ET.Element, child_name: str) -> str | None:
    child = _child(element, child_name)
    return child.text if child is not None else None
