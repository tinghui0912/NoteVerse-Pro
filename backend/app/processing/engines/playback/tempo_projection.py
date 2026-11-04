"""Ephemeral admitted-document adaptation and binary MIDI conductor projection."""

from fractions import Fraction
from copy import deepcopy
from collections.abc import Sequence
import xml.etree.ElementTree as ET

from app.score_semantics.musicxml_sound_position import select_sound_playback_offset


def playback_musicxml(admitted: bytes) -> str:
    """Adapt already-admitted canonical bytes for playback-only renderer input."""
    root = ET.fromstring(admitted)
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
    # Verovio uses direction offsets even when visual-only, and ignores offsets
    # owned by sound. Project the selected playback fact to its supported slot.
    for direction in list(root.iter()):
        if direction.tag.rsplit("}", 1)[-1] != "direction":
            continue
        sound = next(
            (child for child in direction if child.tag.rsplit("}", 1)[-1] == "sound"), None
        )
        if sound is None or "tempo" not in sound.attrib:
            continue
        selected = select_sound_playback_offset(direction)
        offset = deepcopy(selected) if selected is not None else None
        for child in list(direction):
            if child.tag.rsplit("}", 1)[-1] == "offset":
                direction.remove(child)
        if offset is not None:
            offset.set("sound", "yes")
            direction.insert(list(direction).index(sound), offset)
    # Namespace prefixes are presentation syntax; renderer input uses local names.
    for element in root.iter():
        element.tag = element.tag.rsplit("}", 1)[-1]
    return ET.tostring(root, encoding="unicode")


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
    # Binary conductor states may coalesce after tick quantization; ordered
    # canonical encounter facts remain intact in the performance plan.
    states = {round(beat * ppq): bpm for beat, bpm in tempos}
    for tempo_tick, bpm in states.items():
        microseconds = round(Fraction(60_000_000) / bpm)
        if not 0 < microseconds < 1 << 24:
            raise ValueError("Unrepresentable MIDI tempo")
        events.append((tempo_tick, b"\xff\x51\x03" + microseconds.to_bytes(3, "big")))
    events.sort(key=lambda event: event[0])
    events.append((max(terminal, events[-1][0]), b"\xff\x2f\x00"))
    output = bytearray()
    previous = 0
    for tick, event in events:
        output.extend(_vlq(tick - previous) + event)
        previous = tick
    return midi[:18] + len(output).to_bytes(4, "big") + output + midi[end:]
