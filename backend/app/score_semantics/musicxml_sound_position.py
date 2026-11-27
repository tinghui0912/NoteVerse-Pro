"""Effective MusicXML sound offsets on an exact quarter-note axis.

This owner resolves relative playback placement only; the written score owns
the current musical cursor and consumers own the meaning of each sound fact.
"""

from decimal import Decimal
from fractions import Fraction
import re
import xml.etree.ElementTree as ET


class MusicXMLSoundPositionError(ValueError):
    pass


def _one(element: ET.Element, name: str) -> ET.Element | None:
    found = [child for child in element if child.tag.rsplit("}", 1)[-1] == name]
    if len(found) > 1:
        raise MusicXMLSoundPositionError(f"Ambiguous sound position {name}")
    return found[0] if found else None


def select_sound_playback_offset(element: ET.Element) -> ET.Element | None:
    """Select the source positioning fact without interpreting its numeric value.

    A sound-owned offset overrides its direction. Direction offsets affect
    playback only with sound="yes"; the attribute defaults to "no".
    """
    kind = element.tag.rsplit("}", 1)[-1]
    if kind not in {"direction", "sound"}:
        raise MusicXMLSoundPositionError("Expected direction or sound")
    sound = element if kind == "sound" else _one(element, "sound")
    direction_offset = _one(element, "offset") if kind == "direction" else None
    if direction_offset is not None and direction_offset.get("sound", "no") not in {"yes", "no"}:
        raise MusicXMLSoundPositionError("Invalid direction offset sound attribute")
    offset = _one(sound, "offset") if sound is not None else None
    if offset is None and direction_offset is not None and direction_offset.get("sound") == "yes":
        offset = direction_offset
    return offset


def resolve_sound_offset_quarters(element: ET.Element, divisions: Fraction | None) -> Fraction:
    """Convert the effective sound offset from divisions to exact quarters."""
    offset = select_sound_playback_offset(element)
    if offset is None:
        return Fraction(0)
    if divisions is None or divisions <= 0:
        raise MusicXMLSoundPositionError("Sound offset requires positive divisions")
    lexical = offset.text.strip() if offset.text is not None else ""
    if re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)", lexical) is None:
        raise MusicXMLSoundPositionError("Invalid sound offset numeric notation")
    return Fraction(Decimal(lexical)) / divisions
