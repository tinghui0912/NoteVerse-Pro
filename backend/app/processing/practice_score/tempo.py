"""Canonical extraction of tempo segments from MusicXML for PracticeScoreArtifact."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import xml.etree.ElementTree as ET


@dataclass(frozen=True)
class PracticeTempoSegment:
    start_beat: float
    bpm: float


BEAT_UNIT_TO_QUARTERS: dict[str, float] = {
    "1024th": 1.0 / 256.0,
    "512th": 1.0 / 128.0,
    "256th": 1.0 / 64.0,
    "128th": 1.0 / 32.0,
    "64th": 1.0 / 16.0,
    "32nd": 1.0 / 8.0,
    "16th": 1.0 / 4.0,
    "eighth": 0.5,
    "quarter": 1.0,
    "half": 2.0,
    "whole": 4.0,
    "breve": 8.0,
    "long": 16.0,
    "maxima": 32.0,
}


def practice_tempo_segments_from_musicxml(score_file_path: str | Path) -> tuple[PracticeTempoSegment, ...]:
    """Extract canonical quarter-note PracticeTempoSegments from a MusicXML document.

    Only returns explicit tempo markings from MusicXML. If no explicit tempo markings
    exist, returns an empty tuple. If the score file is missing or invalid XML,
    raises the corresponding FileNotFoundError or ParseError.
    """

    path = Path(score_file_path)
    if not path.exists():
        raise FileNotFoundError(f"Score file does not exist: {path}")

    root = ET.parse(path).getroot()

    first_part = next(iter(_direct_children_by_local_name(root, "part")), None)
    if first_part is None:
        return ()

    divisions = 1.0
    current_measure_duration_beats = 4.0
    measure_start_beat = 0.0
    raw_segments: list[tuple[float, float]] = []

    for measure in _direct_children_by_local_name(first_part, "measure"):
        cursor = 0.0
        measure_extent = 0.0

        for element in list(measure):
            tag = _local_name(element.tag)

            if tag == "attributes":
                if divisions_text := _child_text(element, "divisions"):
                    divisions = _positive_float_or_default(divisions_text, divisions)
                time_node = element.find("{*}time")
                if time_node is not None:
                    numerator = _positive_int_or_default(_child_text(time_node, "beats"), 0)
                    denominator = _positive_int_or_default(_child_text(time_node, "beat-type"), 0)
                    if numerator > 0 and denominator > 0:
                        current_measure_duration_beats = numerator * (4.0 / denominator)
                continue

            if tag in {"direction", "sound"}:
                extracted_bpm = _extract_tempo_bpm(element)
                if extracted_bpm is not None and extracted_bpm > 0:
                    offset = 0.0
                    if tag == "direction":
                        if offset_text := _child_text(element, "offset"):
                            offset = _duration_beats_raw(float(offset_text), divisions)
                    beat = max(0.0, _round_beat(measure_start_beat + cursor + offset))
                    raw_segments.append((beat, extracted_bpm))
                continue

            if tag in {"note", "forward"}:
                if tag == "note":
                    is_chord = any(_local_name(child.tag) == "chord" for child in list(element))
                    if is_chord:
                        continue
                duration = _duration_beats(element, divisions)
                cursor += duration
                measure_extent = max(measure_extent, cursor)
            elif tag == "backup":
                cursor = max(0.0, cursor - _duration_beats(element, divisions))

        measure_start_beat += measure_extent if measure_extent > 0 else current_measure_duration_beats

    if not raw_segments:
        return ()

    merged: dict[float, float] = {}
    for beat, bpm in raw_segments:
        merged[beat] = bpm

    return tuple(
        PracticeTempoSegment(start_beat=beat, bpm=merged[beat])
        for beat in sorted(merged)
    )


def _extract_tempo_bpm(element: ET.Element) -> float | None:
    tag = _local_name(element.tag)

    if tag == "sound":
        tempo_attr = element.get("tempo")
        if tempo_attr:
            return _positive_float_or_none(tempo_attr)
        return None

    if tag == "direction":
        sound_child = element.find("{*}sound")
        if sound_child is not None:
            tempo_attr = sound_child.get("tempo")
            if tempo_attr:
                return _positive_float_or_none(tempo_attr)

        for dir_type in _direct_children_by_local_name(element, "direction-type"):
            metronome = next(iter(_direct_children_by_local_name(dir_type, "metronome")), None)
            if metronome is not None:
                return _parse_metronome(metronome)

    return None


def _parse_metronome(metronome: ET.Element) -> float | None:
    per_minute_text = _child_text(metronome, "per-minute")
    if not per_minute_text:
        return None

    try:
        per_minute = float(per_minute_text)
    except ValueError:
        return None

    if per_minute <= 0:
        return None

    beat_unit_text = _child_text(metronome, "beat-unit")
    unit_quarters = BEAT_UNIT_TO_QUARTERS.get(beat_unit_text or "quarter", 1.0)

    dots = sum(1 for child in list(metronome) if _local_name(child.tag) == "beat-unit-dot")
    dot_multiplier = sum(1.0 / (2.0 ** i) for i in range(dots + 1))

    return per_minute * unit_quarters * dot_multiplier


def _duration_beats(element: ET.Element, divisions: float) -> float:
    duration = _positive_float_or_default(_child_text(element, "duration"), 0.0)
    return _duration_beats_raw(duration, divisions)


def _duration_beats_raw(duration: float, divisions: float) -> float:
    if duration <= 0 or divisions <= 0:
        return 0.0
    return _round_beat(duration / divisions)


def _round_beat(beat: float) -> float:
    return round(float(beat), 4)


def _positive_float_or_default(value: str | None, default: float) -> float:
    if value is None:
        return default
    try:
        parsed = float(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _positive_float_or_none(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def _positive_int_or_default(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _direct_children_by_local_name(element: ET.Element, name: str) -> tuple[ET.Element, ...]:
    return tuple(child for child in list(element) if _local_name(child.tag) == name)


def _child_text(element: ET.Element, name: str) -> str | None:
    for child in list(element):
        if _local_name(child.tag) == name:
            return child.text.strip() if child.text else None
    return None


def _local_name(tag: str) -> str:
    return tag.split("}")[-1]
