from __future__ import annotations

from dataclasses import dataclass
from typing import cast
import xml.etree.ElementTree as ET

EXTRACTOR_VERSION = "musicxml-metadata-v1"
DEFAULT_TEMPO_BPM = 120.0


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
    measure_durations = [0.0] * measure_count
    first_part_tempos: dict[int, list[tuple[float, float]]] = {}
    first_part_repeats: list[tuple[bool, bool, int]] = []

    for part_index, measures in enumerate(measures_by_part):
        divisions = 1
        for measure_index, measure in enumerate(measures):
            measure_number = measure.get("number") or str(measure_index + 1)
            cursor = 0.0
            maximum = 0.0
            measure_tempos: list[tuple[float, float]] = []
            for child in measure:
                child_name = _name(child)
                if child_name == "attributes":
                    divisions_node = _child(child, "divisions")
                    if divisions_node is not None and divisions_node.text:
                        divisions = _positive_int(divisions_node.text, "invalid_divisions")
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
                elif child_name == "direction":
                    tempo = _direction_tempo(child)
                    if tempo is not None:
                        if tempo <= 0:
                            raise MetadataExtractionError("invalid_tempo")
                        event = {
                            "part": part_index + 1,
                            "measure": measure_number,
                            "offset_quarters": round(cursor, 6),
                            "bpm": tempo,
                        }
                        tempo_events.append(event)
                        measure_tempos.append((cursor, tempo))
                elif child_name == "backup":
                    cursor = max(0.0, cursor - _duration(child, divisions))
                elif child_name == "forward":
                    cursor += _duration(child, divisions)
                    maximum = max(maximum, cursor)
                elif child_name == "note":
                    duration = _duration(child, divisions)
                    if _child(child, "chord") is None:
                        cursor += duration
                        maximum = max(maximum, cursor)
            measure_durations[measure_index] = max(
                measure_durations[measure_index], maximum
            )
            if part_index == 0:
                first_part_tempos[measure_index] = measure_tempos
                first_part_repeats.append(_repeat_markers(measure))

    order = _playback_order(first_part_repeats)
    duration_ms = _playback_duration_ms(order, measure_durations, first_part_tempos)
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
    durations: list[float],
    tempos: dict[int, list[tuple[float, float]]],
) -> int:
    linear_start_tempos: list[float] = []
    tempo = DEFAULT_TEMPO_BPM
    for index in range(len(durations)):
        linear_start_tempos.append(tempo)
        events = tempos.get(index) or []
        if events:
            tempo = events[-1][1]

    total_seconds = 0.0
    for index in order:
        measure_duration = durations[index]
        cursor = 0.0
        tempo = linear_start_tempos[index]
        for offset, next_tempo in sorted(tempos.get(index) or []):
            bounded = min(max(offset, cursor), measure_duration)
            total_seconds += (bounded - cursor) * 60.0 / tempo
            cursor = bounded
            tempo = next_tempo
        total_seconds += max(0.0, measure_duration - cursor) * 60.0 / tempo
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


def _direction_tempo(direction: ET.Element) -> float | None:
    for descendant in direction.iter():
        if _name(descendant) == "sound" and descendant.get("tempo"):
            return _positive_float(descendant.get("tempo"), "invalid_tempo")
    for descendant in direction.iter():
        if _name(descendant) == "per-minute" and descendant.text:
            return _positive_float(descendant.text, "invalid_tempo")
    return None


def _duration(element: ET.Element, divisions: int) -> float:
    value = _text(element, "duration")
    if value is None:
        return 0.0
    return _positive_float(value, "invalid_duration", allow_zero=True) / divisions


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
    if parsed < 0 or (parsed == 0 and not allow_zero):
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
