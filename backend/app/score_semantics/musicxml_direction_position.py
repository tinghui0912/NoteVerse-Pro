"""MusicXML direction presentation offsets on an exact quarter-note axis.

The written score owns the cursor. A direction offset always moves its visual
marking, independently of whether it also moves associated sound playback.
"""

from decimal import Decimal
from fractions import Fraction
import re
import xml.etree.ElementTree as ET


class MusicXMLDirectionPositionError(ValueError):
    pass


def resolve_direction_offset_quarters(
    direction: ET.Element, divisions: Fraction | None
) -> Fraction:
    if direction.tag.rsplit("}", 1)[-1] != "direction":
        raise MusicXMLDirectionPositionError("Expected direction")
    offsets = [child for child in direction if child.tag.rsplit("}", 1)[-1] == "offset"]
    if len(offsets) > 1:
        raise MusicXMLDirectionPositionError("Ambiguous direction offset")
    if not offsets:
        return Fraction(0)
    if divisions is None or divisions <= 0:
        raise MusicXMLDirectionPositionError("Direction offset requires positive divisions")
    lexical = (offsets[0].text or "").strip()
    if re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)", lexical) is None:
        raise MusicXMLDirectionPositionError("Invalid direction offset numeric notation")
    return Fraction(Decimal(lexical)) / divisions
