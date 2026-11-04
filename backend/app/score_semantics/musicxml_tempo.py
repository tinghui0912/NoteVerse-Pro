"""Explicit MusicXML tempo directives on a rational quarter-note axis.

Sound tempo is the playback fact; a simultaneous metronome must describe the
same quarter-note rate. Missing notation produces no fact and no default.
"""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, localcontext
from fractions import Fraction
import math
import re
import xml.etree.ElementTree as ET
from typing import TypeVar

from .musicxml_sound_position import MusicXMLSoundPositionError, resolve_sound_offset_quarters
from .written_point import WrittenPoint

TempoSlot = TypeVar("TempoSlot", Fraction, WrittenPoint)


class MusicXMLTempoError(ValueError):
    pass


@dataclass(frozen=True)
class TempoDirective:
    quarter_bpm: Fraction
    playback_offset_quarters: Fraction


_BEAT_UNITS = {
    "1024th": Fraction(1, 256),
    "512th": Fraction(1, 128),
    "256th": Fraction(1, 64),
    "128th": Fraction(1, 32),
    "64th": Fraction(1, 16),
    "32nd": Fraction(1, 8),
    "16th": Fraction(1, 4),
    "eighth": Fraction(1, 2),
    "quarter": Fraction(1),
    "half": Fraction(2),
    "whole": Fraction(4),
    "breve": Fraction(8),
    "long": Fraction(16),
    "maxima": Fraction(32),
}


def _name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _children(element: ET.Element, name: str) -> list[ET.Element]:
    return [e for e in element if _name(e) == name]


def _one(element: ET.Element, name: str) -> ET.Element | None:
    found = _children(element, name)
    if len(found) > 1:
        raise MusicXMLTempoError(f"Ambiguous tempo {name}")
    return found[0] if found else None


def _number(value: str | None, *, positive: bool = False) -> Fraction:
    lexical = value.strip() if value is not None else ""
    if re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)", lexical) is None:
        raise MusicXMLTempoError("Invalid tempo numeric notation")
    try:
        result = Fraction(Decimal(lexical))
        projected = float(result)
    except (ValueError, InvalidOperation, OverflowError) as error:
        raise MusicXMLTempoError("Unrepresentable tempo number") from error
    if not math.isfinite(projected) or positive and (result <= 0 or projected <= 0):
        raise MusicXMLTempoError("Tempo must be finite and positive")
    return result


def parse_tempo_directive(element: ET.Element, divisions: Fraction | None) -> TempoDirective | None:
    sound = element if _name(element) == "sound" else _one(element, "sound")
    sound_bpm = (
        _number(sound.get("tempo"), positive=True)
        if sound is not None and "tempo" in sound.attrib
        else None
    )
    metronomes = [
        m for d in _children(element, "direction-type") for m in _children(d, "metronome")
    ]
    if len(metronomes) > 1:
        raise MusicXMLTempoError("Ambiguous metronome directives")
    marked_bpm = None
    if metronomes:
        marking = metronomes[0]
        if any(_name(e) not in {"beat-unit", "beat-unit-dot", "per-minute"} for e in marking):
            raise MusicXMLTempoError("Unsupported metronome notation")
        unit, rate = _one(marking, "beat-unit"), _one(marking, "per-minute")
        unit_name = unit.text.strip() if unit is not None and unit.text else ""
        if unit_name not in _BEAT_UNITS or rate is None:
            raise MusicXMLTempoError("Unsupported metronome rate or beat unit")
        dots = len(_children(marking, "beat-unit-dot"))
        marked_bpm = (
            _number(rate.text, positive=True)
            * _BEAT_UNITS[unit_name]
            * sum((Fraction(1, 2**i) for i in range(dots + 1)), Fraction(0))
        )
        try:
            projected = float(marked_bpm)
        except OverflowError as error:
            raise MusicXMLTempoError("Unrepresentable metronome rate") from error
        if not math.isfinite(projected) or projected <= 0:
            raise MusicXMLTempoError("Unrepresentable metronome rate")
    if sound_bpm is not None and marked_bpm is not None and sound_bpm != marked_bpm:
        raise MusicXMLTempoError("Sound and metronome tempos conflict")
    bpm = sound_bpm if sound_bpm is not None else marked_bpm
    if bpm is None:
        return None
    try:
        offset = resolve_sound_offset_quarters(element, divisions)
    except MusicXMLSoundPositionError as error:
        raise MusicXMLTempoError("Invalid tempo playback position") from error
    return TempoDirective(bpm, offset)


def put_tempo_fact(facts: dict[TempoSlot, Fraction], position: TempoSlot, bpm: Fraction) -> None:
    """Check one semantic slot: a written point or an already performed coordinate."""
    quarter = position.position if isinstance(position, WrittenPoint) else position
    if quarter < 0:
        raise MusicXMLTempoError("Tempo precedes the score origin")
    if position in facts and facts[position] != bpm:
        raise MusicXMLTempoError("Conflicting tempos at one score position")
    facts[position] = bpm


def materialize_tempo_playback(root: ET.Element) -> bool:
    """Validate directives and make their quarter-BPM playback facts explicit.

    Preserve metronome presentation, including units and dots. Renderer consumers
    receive the same semantic rate in sound@tempo without interpreting that mark.
    No default directive is inserted when notation is missing.
    """
    changed = False
    if _name(root) == "score-timewise":
        groups: dict[str, list[ET.Element]] = {}
        for measure in _children(root, "measure"):
            for part in _children(measure, "part"):
                groups.setdefault(part.get("id", ""), []).append(part)
        part_measures = list(groups.values())
    else:
        part_measures = [_children(part, "measure") for part in _children(root, "part")]
    for measures in part_measures:
        divisions = None
        for measure in measures:
            for element in measure:
                if _name(element) == "attributes":
                    value = _one(element, "divisions")
                    if value is not None:
                        divisions = _number(value.text, positive=True)
                elif _name(element) in {"direction", "sound"}:
                    directive = parse_tempo_directive(element, divisions)
                    if directive is None or _name(element) == "sound":
                        continue
                    sound = _one(element, "sound")
                    if sound is not None and "tempo" in sound.attrib:
                        continue
                    if sound is None:
                        namespace = element.tag.removesuffix("direction")
                        sound = ET.SubElement(element, namespace + "sound")
                    rate = directive.quarter_bpm
                    # Decimal notation, unit scaling and dots have only 2/5 factors
                    # in the denominator; this precision represents the rate exactly.
                    with localcontext() as context:
                        context.prec = (
                            len(str(abs(rate.numerator))) + len(str(rate.denominator)) * 4
                        )
                        tempo_text = format(
                            Decimal(rate.numerator) / Decimal(rate.denominator), "f"
                        )
                    sound.set("tempo", tempo_text)
                    changed = True
    return changed
