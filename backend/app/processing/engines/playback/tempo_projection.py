"""Adapt renderer-owned MEI positions to a MIDI conductor tempo chronology.

No MusicXML note/measure arithmetic lives here: Verovio owns measure positions,
repeat unfolding and MEI timestamps. midi.bpm is an already canonical quarter rate.
"""

from fractions import Fraction
from collections import defaultdict
from collections.abc import Sequence
from typing import Any
import xml.etree.ElementTree as ET

from app.processing.musicxml.validation import prepare_musicxml_document
from app.score_semantics.musicxml_tempo import put_tempo_fact

_XML_ID = "{http://www.w3.org/XML/1998/namespace}id"


def playback_musicxml(content: bytes) -> str:
    """Ephemeral renderer input; make standalone sound placement direction-scoped."""
    root = ET.fromstring(prepare_musicxml_document(content))
    for parent in root.iter():
        for index, element in enumerate(list(parent)):
            if (
                element.tag.rsplit("}", 1)[-1] == "sound"
                and "tempo" in element.attrib
                and parent.tag.rsplit("}", 1)[-1] != "direction"
            ):
                direction = ET.Element(element.tag.removesuffix("sound") + "direction")
                parent.remove(element)
                parent.insert(index, direction)
                direction.append(element)
    # Namespace prefixes are presentation syntax; renderer input uses local names.
    for element in root.iter():
        element.tag = element.tag.rsplit("}", 1)[-1]
    return ET.tostring(root, encoding="unicode")


def renderer_tempo_events(
    mei: str,
    timemap: Sequence[dict[str, Any]],
    default_bpm: int,
    expansion_map: dict[str, list[str]],
) -> list[tuple[Fraction, Fraction]]:
    starts: dict[str, list[Fraction]] = defaultdict(list)
    for event in timemap:
        if "measureOn" in event:
            starts[event["measureOn"]].append(Fraction(str(event["qstamp"])))
    facts: dict[Fraction, Fraction] = {}
    units: dict[str, Fraction] = {}
    root = ET.fromstring(mei)
    for element in root.iter():
        name = element.tag.rsplit("}", 1)[-1]
        if name == "staffDef":
            signature = next((e for e in element if e.tag.endswith("}meterSig")), None)
            if signature is not None:
                units[element.attrib["n"]] = Fraction(signature.attrib["unit"])
        elif name == "measure":
            for staff in element:
                if not staff.tag.endswith("}staff"):
                    continue
                for signature in staff.iter():
                    if signature.tag.endswith("}meterSig"):
                        units[staff.attrib["n"]] = Fraction(signature.attrib["unit"])
            for tempo in element:
                if not tempo.tag.endswith("}tempo") or "midi.bpm" not in tempo.attrib:
                    continue
                stamp = Fraction(tempo.attrib["tstamp"]) - 1
                offset = Fraction(0)
                if stamp:
                    staff_units = {units[staff] for staff in tempo.attrib["staff"].split()}
                    if len(staff_units) != 1:
                        raise ValueError("Ambiguous renderer tempo position")
                    # MEI tstamp is one-based in the renderer's current meter unit.
                    offset = stamp * 4 / staff_units.pop()
                measure_id = element.attrib[_XML_ID]
                occurrence_ids = expansion_map.get(measure_id, [measure_id])
                measure_starts = [
                    start for identity in occurrence_ids for start in starts[identity]
                ]
                if not measure_starts:
                    raise ValueError("Missing renderer measure position")
                for start in measure_starts:
                    put_tempo_fact(facts, start + offset, Fraction(tempo.attrib["midi.bpm"]))
    if Fraction(0) not in facts:
        facts[Fraction(0)] = Fraction(default_bpm)
    return sorted(facts.items())


def _read_vlq(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    for _ in range(4):
        byte = data[offset]
        offset += 1
        value = (value << 7) | (byte & 0x7F)
        if byte < 0x80:
            return value, offset
    raise ValueError("Invalid MIDI variable-length quantity")


def _vlq(value: int) -> bytes:
    if not 0 <= value < 1 << 28:
        raise ValueError("Unrepresentable MIDI delta")
    output = [value & 0x7F]
    while value >> 7:
        value >>= 7
        output.append((value & 0x7F) | 0x80)
    return bytes(reversed(output))


def project_midi_tempos(midi: bytes, tempos: Sequence[tuple[Fraction, Fraction]]) -> bytes:
    """Replace Verovio's conductor tempo events; preserve every other track byte."""
    if midi[:8] != b"MThd\x00\x00\x00\x06" or midi[8:10] != b"\x00\x01" or midi[14:18] != b"MTrk":
        raise ValueError("Unsupported renderer MIDI layout")
    ppq = int.from_bytes(midi[12:14], "big")
    if not 0 < ppq < 0x8000:
        raise ValueError("Renderer MIDI requires quarter-note division")
    end = 22 + int.from_bytes(midi[18:22], "big")
    conductor = midi[22:end]
    position = tick = terminal = 0
    events: list[tuple[int, bytes]] = []
    while position < len(conductor):
        delta, position = _read_vlq(conductor, position)
        tick += delta
        if conductor[position] != 0xFF:
            raise ValueError("Renderer conductor must contain only metadata")
        kind = conductor[position + 1]
        length, payload = _read_vlq(conductor, position + 2)
        position = payload + length
        if position > len(conductor):
            raise ValueError("Truncated renderer conductor")
        if kind == 0x2F:
            terminal = tick
        elif kind != 0x51:
            events.append(
                (tick, b"\xff" + bytes([kind]) + _vlq(length) + conductor[payload:position])
            )
    for beat, bpm in tempos:
        microseconds = round(Fraction(60_000_000) / bpm)
        if not 0 < microseconds < 1 << 24:
            raise ValueError("Unrepresentable MIDI tempo")
        events.append((round(beat * ppq), b"\xff\x51\x03" + microseconds.to_bytes(3, "big")))
    events.sort(key=lambda event: event[0])
    events.append((max(terminal, events[-1][0]), b"\xff\x2f\x00"))
    output = bytearray()
    previous = 0
    for tick, event in events:
        output.extend(_vlq(tick - previous) + event)
        previous = tick
    return midi[:18] + len(output).to_bytes(4, "big") + output + midi[end:]
