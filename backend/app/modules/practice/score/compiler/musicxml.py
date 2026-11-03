"""Compile prepared MusicXML onto one quarter-note beat axis.

Cursor arithmetic is rational. All exported positions use domain.canonical_beat.
Parts share measure boundaries; a measure advances by its maximum part extent.
An actually empty measure advances by the established meter's nominal duration.
"""

from __future__ import annotations
from fractions import Fraction
from typing import NoReturn, TypeVar
from decimal import Decimal, InvalidOperation
import math
import re
import xml.etree.ElementTree as ET
from ..domain import (
    CompiledPracticeScore,
    CompiledPracticeNote,
    CompiledPracticeMeasure,
    PracticeMeterSegment,
    PracticeTempoSegment,
    canonical_beat,
)
from ..piano_key import PracticeScoreInvalidError, practice_piano_key

from app.score_semantics.musicxml_tempo import (
    MusicXMLTempoError,
    parse_tempo_directive,
    put_tempo_fact,
)

T = TypeVar("T")

PITCH_STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def compile_practice_score(prepared_musicxml: bytes | str) -> CompiledPracticeScore:
    try:
        root = ET.fromstring(prepared_musicxml)
    except (ET.ParseError, UnicodeError) as cause:
        raise PracticeScoreInvalidError("Invalid Practice MusicXML.") from cause
    if local(root.tag) != "score-partwise":
        invalid("Practice requires partwise MusicXML.")
    if any(local(e.tag) == "senza-misura" for e in root.iter()):
        invalid("Unmetered notation is unsupported for Practice.")
    parts = children(root, "part")
    measures = [children(part, "measure") for part in parts]
    if not parts or not any(measures):
        invalid("Practice requires explicit initial meter timing.")
    if len({len(part_measures) for part_measures in measures}) != 1:
        invalid("Practice requires aligned part measure sequences.")
    divisions: list[Fraction | None] = [None] * len(parts)
    meters: dict[Fraction, tuple[int, int]] = {}
    tempos: dict[Fraction, Fraction] = {}
    notes: list[CompiledPracticeNote] = []
    compiled_measures = []
    used_ids: set[str] = set()
    exported_positions: dict[float, Fraction] = {}

    def beat(position: Fraction) -> float:
        result = canonical_beat(position)
        if result in exported_positions and exported_positions[result] != position:
            invalid("Distinct score positions collapse at canonical beat precision.")
        exported_positions[result] = position
        return result

    start = Fraction(0)
    for measure_index in range(max(map(len, measures))):
        extent = Fraction(0)
        for part_index, part_measures in enumerate(measures):
            if measure_index >= len(part_measures):
                continue
            measure = part_measures[measure_index]
            cursor = Fraction(0)
            part_extent = Fraction(0)
            chord_onset: Fraction | None = None
            chord_voice = ""
            selectable = 0
            for element in measure:
                tag = local(element.tag)
                position = start + cursor
                if tag == "attributes":
                    for attribute in element:
                        if local(attribute.tag) == "divisions":
                            divisions[part_index] = positive(attribute.text, "divisions")
                        elif local(attribute.tag) == "transpose":
                            invalid("Transposing notation is unsupported for Practice.")
                        elif local(attribute.tag) == "time":
                            if (
                                cursor != 0
                                or len(children(attribute, "beats")) != 1
                                or len(children(attribute, "beat-type")) != 1
                            ):
                                invalid("Unsupported Practice meter placement or grouping.")
                            numerator = integer(text(attribute, "beats"), "meter numerator")
                            denominator = integer(text(attribute, "beat-type"), "meter denominator")
                            if numerator <= 0 or denominator <= 0:
                                invalid("Invalid Practice meter.")
                            put(meters, position, (numerator, denominator), "meter")
                    continue
                if tag in {"direction", "sound"}:
                    try:
                        directive = parse_tempo_directive(element, divisions[part_index])
                        if directive is not None:
                            put_tempo_fact(
                                tempos, position + directive.offset_quarters, directive.quarter_bpm
                            )
                    except MusicXMLTempoError as error:
                        raise PracticeScoreInvalidError(str(error)) from error
                    continue
                if tag not in {"note", "forward", "backup"}:
                    continue
                active_meter(meters, position)
                if tag == "note" and child(element, "grace") is not None:
                    invalid("Zero-time grace notation is unsupported for Practice.")
                duration = positive(text(element, "duration"), "duration") / require_divisions(
                    divisions[part_index]
                )
                if tag == "backup":
                    cursor -= duration
                    if cursor < 0:
                        invalid("Backup precedes its measure origin.")
                    chord_onset = None
                    continue
                selectable += 1
                if tag == "forward":
                    cursor += duration
                    part_extent = max(part_extent, cursor)
                    chord_onset = None
                    continue
                voice = text(element, "voice") or ""
                is_chord = child(element, "chord") is not None
                if is_chord:
                    if chord_onset is None or chord_voice != voice:
                        invalid("Chord has no preceding note in its voice.")
                    onset = chord_onset
                else:
                    onset = cursor
                    chord_onset, chord_voice = onset, voice
                    cursor += duration
                part_extent = max(part_extent, onset + duration)
                if child(element, "rest") is not None:
                    if is_chord:
                        invalid("A chord member must be pitched notation.")
                    chord_onset = None
                    continue
                pitch = child(element, "pitch")
                if pitch is None:
                    invalid("Practice requires explicit pitched notes.")
                step = text(pitch, "step")
                if step not in PITCH_STEPS:
                    invalid("Invalid Practice pitch step.")
                octave = integer(text(pitch, "octave"), "pitch octave")
                alter = (
                    number(text(pitch, "alter"), "pitch alter")
                    if child(pitch, "alter") is not None
                    else Fraction(0)
                )
                if alter.denominator != 1:
                    invalid("Practice requires integer physical piano keys.")
                key = practice_piano_key(12 * (octave + 1) + PITCH_STEPS[step] + int(alter))
                render_id = element.get("id", "")
                if not render_id or render_id in used_ids:
                    invalid("Prepared notation requires unique note identities.")
                used_ids.add(render_id)
                ties = tuple(e.get("type", "") for e in element if local(e.tag) == "tie")
                if len(set(ties)) != len(ties) or any(t not in {"start", "stop"} for t in ties):
                    invalid("Unsupported Practice tie facts.")
                onset_beat = beat(start + onset)
                duration_beats = canonical_beat(beat(start + onset + duration) - onset_beat)
                if duration_beats <= 0:
                    invalid("Note duration is below canonical beat precision.")
                notes.append(
                    CompiledPracticeNote(
                        render_id,
                        onset_beat,
                        duration_beats,
                        key,
                        measure.get("number", ""),
                        (text(element, "staff") or "")
                        if len(parts) == 1
                        else f"p{part_index + 1}:s:{text(element, 'staff') or '1'}",
                        voice,
                        f"p{part_index + 1}-m{measure_index + 1}-e{selectable}",
                        ties,
                    )
                )
            active_meter(meters, start)
            extent = max(extent, part_extent)
        empty = extent == 0
        if empty:
            numerator, denominator = active_meter(meters, start)
            extent = Fraction(numerator * 4, denominator)
        compiled_measures.append(
            CompiledPracticeMeasure(measure_index, beat(start), beat(start + extent), empty)
        )
        start += extent
    if not meters or min(meters) != 0:
        invalid("Practice requires explicit initial meter timing.")
    meter_segments = tuple(
        PracticeMeterSegment(beat(position), *value) for position, value in sorted(meters.items())
    )
    for meter in meter_segments:
        _ = meter.measure_duration_beats
    tempo_segments = tuple(
        PracticeTempoSegment(beat(position), finite_float(value))
        for position, value in sorted(tempos.items())
    )
    # Canonicalization must preserve strict ordering of distinct source positions.
    for positions in (
        [m.start_beat for m in meter_segments],
        [t.start_beat for t in tempo_segments],
    ):
        if any(a >= b for a, b in zip(positions, positions[1:])):
            invalid("Timing changes are indistinguishable at canonical beat precision.")
    return CompiledPracticeScore(
        tuple(notes), meter_segments, tempo_segments, tuple(compiled_measures)
    )


def active_meter(meters: dict[Fraction, tuple[int, int]], position: Fraction) -> tuple[int, int]:
    candidates = [beat for beat in meters if beat <= position]
    if not candidates:
        invalid("Practice requires explicit initial meter timing.")
    return meters[max(candidates)]


def require_divisions(value: Fraction | None) -> Fraction:
    if value is None:
        invalid("Explicit divisions required for Practice chronology.")
    return value


def put(values: dict[Fraction, T], position: Fraction, value: T, fact: str) -> None:
    if position in values and values[position] != value:
        invalid(f"Conflicting Practice {fact} at one canonical position.")
    values[position] = value


def number(value: str | None, fact: str) -> Fraction:
    try:
        lexical = value.strip() if value is not None else ""
        if re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)", lexical) is None:
            invalid(f"Invalid Practice {fact} number.")
        decimal = Decimal(lexical)
        if not decimal.is_finite():
            invalid(f"Nonfinite Practice {fact}.")
        result = Fraction(decimal)
        finite_float(result)
        return result
    except (ValueError, InvalidOperation, ZeroDivisionError, OverflowError) as cause:
        raise PracticeScoreInvalidError(f"Invalid Practice {fact}.") from cause


def positive(value: str | None, fact: str) -> Fraction:
    result = number(value, fact)
    if result <= 0 or finite_float(result) <= 0:
        invalid(f"Practice {fact} must be positive.")
    return result


def integer(value: str | None, fact: str) -> int:
    result = number(value, fact)
    if result.denominator != 1:
        invalid(f"Practice {fact} must be an integer.")
    return int(result)


def finite_float(value: Fraction) -> float:
    try:
        result = float(value)
    except OverflowError as cause:
        raise PracticeScoreInvalidError("Unrepresentable Practice timing.") from cause
    if not math.isfinite(result):
        invalid("Nonfinite Practice timing.")
    return result


def child(element: ET.Element, name: str) -> ET.Element | None:
    matches = children(element, name)
    if len(matches) > 1:
        invalid(f"Ambiguous Practice {name} fact.")
    return matches[0] if matches else None


def children(element: ET.Element, name: str) -> tuple[ET.Element, ...]:
    return tuple(e for e in element if local(e.tag) == name)


def text(element: ET.Element, name: str) -> str | None:
    found = child(element, name)
    return found.text.strip() if found is not None and found.text else None


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def invalid(message: str) -> NoReturn:
    raise PracticeScoreInvalidError(message)
