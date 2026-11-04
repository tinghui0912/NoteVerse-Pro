"""Immutable written MusicXML facts on an exact quarter-note axis.

This parser owns notation chronology, not performance traversal or product policy.
Repeat signs are observations at written measures; they never duplicate positions.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from fractions import Fraction
import re
import xml.etree.ElementTree as ET

from .musicxml_tempo import MusicXMLTempoError, parse_tempo_directive, put_tempo_fact
from .musicxml_sound_position import MusicXMLSoundPositionError, resolve_sound_offset_quarters
from .written_point import (
    WrittenPoint,
    WrittenPointError,
    AmbiguousWrittenPointError,
    resolve_written_point,
)


class MusicXMLSemanticError(ValueError):
    """Invalid or unsupported written semantics, independent of any consumer."""


@dataclass(frozen=True)
class WrittenPart:
    index: int
    part_id: str
    measure_numbers: tuple[str, ...]


@dataclass(frozen=True)
class WrittenMeasure:
    index: int
    start: Fraction
    end: Fraction
    uses_meter_duration: bool
    part_extents: tuple[Fraction | None, ...]


@dataclass(frozen=True)
class WrittenPosition:
    part_index: int
    measure_index: int
    measure_number: str
    position: Fraction

    @property
    def point(self) -> WrittenPoint:
        return WrittenPoint(self.measure_index, self.position)


@dataclass(frozen=True)
class WrittenPitch:
    step: str
    octave: int
    alter: Fraction


@dataclass(frozen=True)
class WrittenNote(WrittenPosition):
    duration: Fraction
    voice: str
    staff: str
    source_id: str
    # One-based note/forward ordinal within the written part measure.
    sequence: int
    is_rest: bool
    is_grace: bool
    is_chord: bool
    pitch: WrittenPitch | None
    ties: tuple[str, ...]


@dataclass(frozen=True)
class WrittenMeter(WrittenPosition):
    staff_number: int | None
    # Each beats/beat-type pair retains additive beats and its own denominator.
    # An empty tuple denotes explicitly unmetered notation.
    groups: tuple[tuple[tuple[int, ...], int], ...]

    @property
    def duration_quarters(self) -> Fraction:
        if not self.groups:
            raise MusicXMLSemanticError("empty_measure_requires_meter")
        return sum(
            (Fraction(sum(beats) * 4, denominator) for beats, denominator in self.groups),
            Fraction(0),
        )


@dataclass(frozen=True)
class WrittenTempo(WrittenPosition):
    quarter_bpm: Fraction


@dataclass(frozen=True)
class WrittenKeyAlteration:
    step: str
    alter: Fraction
    accidental: str | None


@dataclass(frozen=True)
class WrittenKey(WrittenPosition):
    staff_number: int | None
    fifths: int | None
    mode: str | None
    alterations: tuple[WrittenKeyAlteration, ...]


@dataclass(frozen=True)
class WrittenRepeat:
    part_index: int
    measure_index: int
    location: str
    direction: str
    times: int | None
    after_jump: bool | None


@dataclass(frozen=True)
class WrittenEnding:
    part_index: int
    measure_index: int
    location: str
    type: str
    raw_number: str
    passes: tuple[int, ...] | None


@dataclass(frozen=True)
class WrittenSoundNavigation(WrittenPosition):
    attributes: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class WrittenNavigationMarker:
    part_index: int
    measure_index: int
    source: str
    kind: str


@dataclass(frozen=True)
class CanonicalScoreSemanticModel:
    parts: tuple[WrittenPart, ...]
    measures: tuple[WrittenMeasure, ...]
    notes: tuple[WrittenNote, ...]
    meters: tuple[WrittenMeter, ...]
    tempos: tuple[WrittenTempo, ...]
    keys: tuple[WrittenKey, ...]
    repeats: tuple[WrittenRepeat, ...]
    endings: tuple[WrittenEnding, ...]
    sound_navigation: tuple[WrittenSoundNavigation, ...]
    navigation_markers: tuple[WrittenNavigationMarker, ...]
    transpositions: tuple[WrittenPosition, ...]

    @property
    def end(self) -> Fraction:
        return self.measures[-1].end


def parse_score_semantics(content: bytes | str) -> CanonicalScoreSemanticModel:
    try:
        root = ET.fromstring(content)
    except (ET.ParseError, UnicodeError) as error:
        raise MusicXMLSemanticError("invalid_xml") from error
    if _name(root) != "score-partwise":
        raise MusicXMLSemanticError("unsupported_root")
    xml_parts = _children(root, "part")
    if not xml_parts:
        raise MusicXMLSemanticError("missing_parts")
    measures_by_part = [_children(part, "measure") for part in xml_parts]
    measure_count = max(map(len, measures_by_part))
    if not measure_count:
        raise MusicXMLSemanticError("missing_measures")
    parts = tuple(
        WrittenPart(i, part.get("id", ""), tuple(m.get("number", "") for m in measures_by_part[i]))
        for i, part in enumerate(xml_parts)
    )
    divisions: list[Fraction | None] = [None] * len(parts)
    notes: list[WrittenNote] = []
    meters: list[WrittenMeter] = []
    tempos: list[WrittenTempo] = []
    keys: list[WrittenKey] = []
    repeats: list[WrittenRepeat] = []
    endings: list[WrittenEnding] = []
    sound_navigation: list[WrittenSoundNavigation] = []
    navigation_markers: list[WrittenNavigationMarker] = []
    transpositions: list[WrittenPosition] = []
    measures: list[WrittenMeasure] = []
    meter_facts: dict[tuple[int, int | None, Fraction], WrittenMeter] = {}
    staff_counts = [1] * len(parts)
    start = Fraction(0)
    for index in range(measure_count):
        extents: list[Fraction | None] = []
        for part_index, part_measures in enumerate(measures_by_part):
            if index >= len(part_measures):
                extents.append(None)
                continue
            measure = part_measures[index]
            number = measure.get("number", "")
            cursor = Fraction(0)
            extent = Fraction(0)
            anchor: WrittenNote | None = None
            sequence = 0
            for element in measure:
                name = _name(element)
                position = start + cursor
                location = WrittenPosition(part_index, index, number, position)
                if name == "attributes":
                    division = _one(element, "divisions")
                    if division is not None:
                        divisions[part_index] = _positive(division.text, "invalid_divisions")
                    staves = _one(element, "staves")
                    if staves is not None:
                        staff_counts[part_index] = _positive_integer(staves.text, "invalid_staves")
                    for attribute in element:
                        kind = _name(attribute)
                        if kind == "transpose":
                            transpositions.append(location)
                        elif kind == "key":
                            key = _key_fact(attribute, location)
                            keys.append(key)
                            if key.staff_number is not None:
                                staff_counts[part_index] = max(
                                    staff_counts[part_index], key.staff_number
                                )
                        elif kind == "time":
                            meter = WrittenMeter(
                                part_index,
                                index,
                                number,
                                position,
                                _staff_number(attribute),
                                _meter_groups(attribute),
                            )
                            slot = (part_index, meter.staff_number, position)
                            if slot in meter_facts and meter_facts[slot].groups != meter.groups:
                                raise MusicXMLSemanticError("conflicting_meter")
                            meter_facts[slot] = meter
                            meters.append(meter)
                            if meter.staff_number is not None:
                                staff_counts[part_index] = max(
                                    staff_counts[part_index], meter.staff_number
                                )
                    continue
                if name in {"direction", "sound"}:
                    for direction_type in _children(element, "direction-type"):
                        for marker in direction_type:
                            if _name(marker) in {"segno", "coda"}:
                                navigation_markers.append(
                                    WrittenNavigationMarker(
                                        part_index, index, "direction", _name(marker)
                                    )
                                )
                    sound = element if name == "sound" else _one(element, "sound")
                    if sound is not None:
                        navigation = tuple(
                            (key, sound.attrib[key])
                            for key in (
                                "dacapo",
                                "dalsegno",
                                "segno",
                                "coda",
                                "tocoda",
                                "fine",
                                "forward-repeat",
                                "time-only",
                            )
                            if key in sound.attrib
                        )
                        if navigation:
                            try:
                                offset = resolve_sound_offset_quarters(
                                    element, divisions[part_index]
                                )
                            except MusicXMLSoundPositionError as error:
                                raise MusicXMLSemanticError(
                                    "invalid_sound_navigation_position"
                                ) from error
                            sound_navigation.append(
                                WrittenSoundNavigation(
                                    part_index, index, number, position + offset, navigation
                                )
                            )
                    try:
                        directive = parse_tempo_directive(element, divisions[part_index])
                        if directive is not None:
                            tempo_position = position + directive.playback_offset_quarters
                            tempos.append(
                                WrittenTempo(
                                    part_index, index, number, tempo_position, directive.quarter_bpm
                                )
                            )
                    except MusicXMLTempoError as error:
                        raise MusicXMLSemanticError("invalid_tempo") from error
                    continue
                if name == "barline":
                    barline_location = element.get("location", "right")
                    if barline_location not in {"left", "right", "middle"}:
                        raise MusicXMLSemanticError("invalid_barline_location")
                    for marker in element:
                        if _name(marker) in {"segno", "coda"}:
                            navigation_markers.append(
                                WrittenNavigationMarker(
                                    part_index, index, f"barline:{barline_location}", _name(marker)
                                )
                            )
                    for repeat in _children(element, "repeat"):
                        direction = repeat.get("direction", "")
                        if direction not in {"forward", "backward"}:
                            raise MusicXMLSemanticError("invalid_repeat_direction")
                        times = (
                            _positive_integer(repeat.get("times", "2"), "invalid_repeat_times")
                            if direction == "backward"
                            else None
                        )
                        after_jump = repeat.get("after-jump")
                        if after_jump is not None and after_jump not in {"yes", "no"}:
                            raise MusicXMLSemanticError("invalid_repeat_after_jump")
                        repeats.append(
                            WrittenRepeat(
                                part_index,
                                index,
                                barline_location,
                                direction,
                                times,
                                after_jump == "yes" if after_jump is not None else None,
                            )
                        )
                    for ending in _children(element, "ending"):
                        kind = ending.get("type", "")
                        if kind not in {"start", "stop", "discontinue"}:
                            raise MusicXMLSemanticError("invalid_ending_type")
                        raw_number = ending.get("number", "")
                        endings.append(
                            WrittenEnding(
                                part_index,
                                index,
                                barline_location,
                                kind,
                                raw_number,
                                _ending_passes(raw_number),
                            )
                        )
                    continue
                if name not in {"note", "backup", "forward"}:
                    continue
                grace = name == "note" and _one(element, "grace") is not None
                if grace:
                    if _one(element, "duration") is not None:
                        raise MusicXMLSemanticError("invalid_grace_duration")
                    duration = Fraction(0)
                else:
                    unit = divisions[part_index]
                    if unit is None:
                        raise MusicXMLSemanticError("missing_divisions")
                    duration = _positive(_text(element, "duration"), "invalid_duration") / unit
                if name == "backup":
                    cursor -= duration
                    if cursor < 0:
                        raise MusicXMLSemanticError("backup_before_measure_origin")
                    anchor = None
                    continue
                sequence += 1
                if name == "forward":
                    cursor += duration
                    extent = max(extent, cursor)
                    anchor = None
                    continue
                voice, staff = _text(element, "voice") or "", _text(element, "staff") or ""
                chord = _one(element, "chord") is not None
                rest = _one(element, "rest") is not None
                if chord:
                    if anchor is None or anchor.voice != voice or anchor.is_grace != grace or rest:
                        raise MusicXMLSemanticError("chord_without_note_anchor")
                    onset = anchor.position
                else:
                    onset = start + cursor
                    cursor += duration
                pitch_xml = _one(element, "pitch")
                pitch = None
                if pitch_xml is not None:
                    step = _text(pitch_xml, "step") or ""
                    if step not in {"A", "B", "C", "D", "E", "F", "G"}:
                        raise MusicXMLSemanticError("invalid_pitch_step")
                    pitch = WrittenPitch(
                        step,
                        _integer(_text(pitch_xml, "octave"), "invalid_pitch_octave"),
                        _number(_text(pitch_xml, "alter"), "invalid_pitch_alter")
                        if _one(pitch_xml, "alter") is not None
                        else Fraction(0),
                    )
                note = WrittenNote(
                    part_index,
                    index,
                    number,
                    onset,
                    duration,
                    voice,
                    staff,
                    element.get("id", ""),
                    sequence,
                    rest,
                    grace,
                    chord,
                    pitch,
                    tuple(t.get("type", "") for t in _children(element, "tie")),
                )
                notes.append(note)
                extent = max(extent, onset - start + duration)
                if not chord:
                    anchor = None if rest else note
            extents.append(extent)
        extent = max((e for e in extents if e is not None), default=Fraction(0))
        empty = extent == 0
        if empty:
            extent = _empty_measure_duration(meter_facts, staff_counts, extents, start)
        measures.append(WrittenMeasure(index, start, start + extent, empty, tuple(extents)))
        start += extent
    if any(t.position > start for t in tempos):
        raise MusicXMLSemanticError("invalid_tempo_position")
    tempo_facts: dict[WrittenPoint, Fraction] = {}
    spans = [(m.start, m.end) for m in measures]
    for tempo in tempos:
        try:
            try:
                tempo_slot = resolve_written_point(tempo.point, spans)
            except AmbiguousWrittenPointError:
                # Written notation can retain an offset whose traversal side is
                # unresolved. It still cannot contradict its own source slot.
                tempo_slot = tempo.point
            put_tempo_fact(tempo_facts, tempo_slot, tempo.quarter_bpm)
        except (WrittenPointError, MusicXMLTempoError) as error:
            raise MusicXMLSemanticError("invalid_tempo") from error
    if any(f.position < 0 or f.position > start for f in sound_navigation):
        raise MusicXMLSemanticError("invalid_sound_navigation_position")
    return CanonicalScoreSemanticModel(
        parts,
        tuple(measures),
        tuple(notes),
        tuple(meters),
        tuple(tempos),
        tuple(keys),
        tuple(repeats),
        tuple(endings),
        tuple(sound_navigation),
        tuple(navigation_markers),
        tuple(transpositions),
    )


def _ending_passes(raw: str) -> tuple[int, ...] | None:
    lexical = raw.strip()
    if not lexical:
        return None
    if re.fullmatch(r"[1-9][0-9]*(?:\s*,\s*[1-9][0-9]*)*", lexical) is None:
        raise MusicXMLSemanticError("invalid_ending_number")
    return tuple(sorted({int(value.strip()) for value in lexical.split(",")}))


def _empty_measure_duration(
    facts: dict[tuple[int, int | None, Fraction], WrittenMeter],
    staff_counts: list[int],
    extents: list[Fraction | None],
    position: Fraction,
) -> Fraction:
    durations: set[Fraction] = set()
    for part_index, extent in enumerate(extents):
        if extent is None:
            continue
        part_facts = [
            m for m in facts.values() if m.part_index == part_index and m.position <= position
        ]
        staffs = {
            m.staff_number
            for m in part_facts
            if m.staff_number is not None and m.staff_number <= staff_counts[part_index]
        }
        relevant_scopes: list[int | None] = list(staffs)
        if len(staffs) < staff_counts[part_index]:
            relevant_scopes.append(None)  # Staves without any individual meter fact.
        for staff in relevant_scopes:
            relevant = [m for m in part_facts if m.staff_number in (None, staff)]
            if not relevant:
                raise MusicXMLSemanticError("empty_measure_requires_meter")
            # A part-wide change applies to all staves; a simultaneous staff fact
            # specializes that staff. Older overrides do not outlive a newer part-wide fact.
            active = max(relevant, key=lambda m: (m.position, m.staff_number is not None))
            durations.add(active.duration_quarters)
    if len(durations) != 1:
        raise MusicXMLSemanticError("ambiguous_empty_measure_duration")
    return durations.pop()


def _staff_number(element: ET.Element) -> int | None:
    value = element.get("number")
    return _positive_integer(value, "invalid_staff_number") if value is not None else None


def _key_fact(element: ET.Element, location: WrittenPosition) -> WrittenKey:
    fifths = _one(element, "fifths")
    alterations = _key_alterations(element)
    if fifths is not None and alterations:
        raise MusicXMLSemanticError("conflicting_key_representation")
    mode = _text(element, "mode")
    if _one(element, "mode") is not None and not mode:
        raise MusicXMLSemanticError("invalid_key_mode")
    return WrittenKey(
        location.part_index,
        location.measure_index,
        location.measure_number,
        location.position,
        _staff_number(element),
        _integer(fifths.text, "invalid_key_fifths") if fifths is not None else None,
        mode.lower() if mode is not None else None,
        alterations,
    )


def _key_alterations(element: ET.Element) -> tuple[WrittenKeyAlteration, ...]:
    alterations: list[WrittenKeyAlteration] = []
    step: str | None = None
    alter: Fraction | None = None
    accidental: str | None = None

    def append() -> None:
        if step is not None:
            if alter is None:
                raise MusicXMLSemanticError("invalid_key_alter")
            alterations.append(WrittenKeyAlteration(step, alter, accidental))

    for child in element:
        name = _name(child)
        if name == "key-step":
            append()
            step = (child.text or "").strip()
            if step not in {"A", "B", "C", "D", "E", "F", "G"}:
                raise MusicXMLSemanticError("invalid_key_step")
            alter = None
            accidental = None
        elif name == "key-alter":
            if step is None or alter is not None:
                raise MusicXMLSemanticError("invalid_key_alter")
            alter = _number(child.text, "invalid_key_alter")
        elif name == "key-accidental":
            if step is None or alter is None or accidental is not None or not child.text:
                raise MusicXMLSemanticError("invalid_key_accidental")
            accidental = child.text.strip()
            if not accidental:
                raise MusicXMLSemanticError("invalid_key_accidental")
    append()
    return tuple(alterations)


def _meter_groups(time: ET.Element) -> tuple[tuple[tuple[int, ...], int], ...]:
    if _children(time, "senza-misura"):
        if _children(time, "beats") or _children(time, "beat-type"):
            raise MusicXMLSemanticError("ambiguous_meter")
        return ()
    groups: list[tuple[tuple[int, ...], int]] = []
    pending: tuple[int, ...] | None = None
    for element in time:
        if _name(element) == "beats":
            if pending is not None:
                raise MusicXMLSemanticError("ambiguous_meter")
            pending = tuple(
                _positive_integer(b, "invalid_time_beats") for b in (element.text or "").split("+")
            )
        elif _name(element) == "beat-type":
            if pending is None:
                raise MusicXMLSemanticError("ambiguous_meter")
            groups.append((pending, _positive_integer(element.text, "invalid_time_beat_type")))
            pending = None
    if not groups or pending is not None:
        raise MusicXMLSemanticError("invalid_meter")
    return tuple(groups)


def _number(value: str | None, code: str) -> Fraction:
    lexical = value.strip() if value is not None else ""
    if re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)", lexical) is None:
        raise MusicXMLSemanticError(code)
    try:
        return Fraction(Decimal(lexical))
    except (ValueError, InvalidOperation, OverflowError) as error:
        raise MusicXMLSemanticError(code) from error


def _positive(value: str | None, code: str) -> Fraction:
    result = _number(value, code)
    if result <= 0:
        raise MusicXMLSemanticError(code)
    return result


def _integer(value: str | None, code: str) -> int:
    result = _number(value, code)
    if result.denominator != 1:
        raise MusicXMLSemanticError(code)
    return int(result)


def _positive_integer(value: str | None, code: str) -> int:
    result = _integer(value, code)
    if result <= 0:
        raise MusicXMLSemanticError(code)
    return result


def _name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _children(element: ET.Element, name: str) -> tuple[ET.Element, ...]:
    return tuple(e for e in element if _name(e) == name)


def _one(element: ET.Element, name: str) -> ET.Element | None:
    matches = _children(element, name)
    if len(matches) > 1:
        raise MusicXMLSemanticError(f"ambiguous_{name}")
    return matches[0] if matches else None


def _text(element: ET.Element, name: str) -> str | None:
    node = _one(element, name)
    return node.text.strip() if node is not None and node.text else None
