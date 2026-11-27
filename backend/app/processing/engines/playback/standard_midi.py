"""Strict Standard MIDI File decoding and exact rational-time serialization."""

from dataclasses import dataclass
from fractions import Fraction
from collections.abc import Iterable
from math import lcm


class MidiRepresentationError(ValueError):
    pass


@dataclass(frozen=True)
class MidiEvent:
    position: Fraction
    status: int
    data: bytes = b""
    meta_type: int | None = None
    tempo_bpm: Fraction | None = None


@dataclass(frozen=True)
class StandardMidiFile:
    ppq: int
    tracks: tuple[tuple[MidiEvent, ...], ...]
    format: int = 1


def exact_output_ppq(input_ppq: int, positions: Iterable[Fraction]) -> int:
    if not 0 < input_ppq < 0x8000:
        raise MidiRepresentationError("unsupported_midi_division")
    ppq = input_ppq
    for position in positions:
        if position < 0:
            raise MidiRepresentationError("negative_midi_position")
        ppq = lcm(ppq, position.denominator)
        if ppq >= 0x8000:
            raise MidiRepresentationError("unrepresentable_exact_midi_ppq")
    return ppq


def _read_vlq(data: bytes, position: int) -> tuple[int, int]:
    value = 0
    for _ in range(4):
        if position >= len(data):
            raise MidiRepresentationError("truncated_midi_vlq")
        byte = data[position]
        position += 1
        value = (value << 7) | (byte & 127)
        if byte < 128:
            return value, position
    raise MidiRepresentationError("invalid_midi_vlq")


def _vlq(value: int) -> bytes:
    if not 0 <= value < 1 << 28:
        raise MidiRepresentationError("unrepresentable_midi_delta")
    output = [value & 127]
    while value >> 7:
        value >>= 7
        output.append((value & 127) | 128)
    return bytes(reversed(output))


def _channel_size(status: int) -> int:
    if not 0x80 <= status < 0xF0:
        raise MidiRepresentationError("unsupported_midi_status")
    return 1 if status & 0xF0 in (0xC0, 0xD0) else 2


def parse_standard_midi(content: bytes) -> StandardMidiFile:
    if len(content) < 14 or content[:8] != b"MThd\x00\x00\x00\x06":
        raise MidiRepresentationError("invalid_midi_header")
    format = int.from_bytes(content[8:10], "big")
    count = int.from_bytes(content[10:12], "big")
    ppq = int.from_bytes(content[12:14], "big")
    if format not in (0, 1) or count == 0 or (format == 0 and count != 1):
        raise MidiRepresentationError("unsupported_midi_format")
    exact_output_ppq(ppq, ())
    cursor = 14
    tracks = []
    for _ in range(count):
        if content[cursor : cursor + 4] != b"MTrk" or cursor + 8 > len(content):
            raise MidiRepresentationError("invalid_midi_track")
        end = cursor + 8 + int.from_bytes(content[cursor + 4 : cursor + 8], "big")
        if end > len(content):
            raise MidiRepresentationError("truncated_midi_track")
        data = content[cursor + 8 : end]
        offset = tick = running = 0
        events = []
        ended = False
        while offset < len(data):
            if ended:
                raise MidiRepresentationError("midi_events_after_end_of_track")
            delta, offset = _read_vlq(data, offset)
            tick += delta
            if offset >= len(data):
                raise MidiRepresentationError("truncated_midi_event")
            status = data[offset]
            if status >= 128:
                offset += 1
            else:
                status = running
            position = Fraction(tick, ppq)
            if status == 0xFF:
                running = 0
                if offset >= len(data):
                    raise MidiRepresentationError("truncated_midi_meta")
                kind = data[offset]
                size, offset = _read_vlq(data, offset + 1)
                payload = data[offset : offset + size]
                if len(payload) != size:
                    raise MidiRepresentationError("truncated_midi_meta")
                offset += size
                if kind == 0x51:
                    if size != 3 or int.from_bytes(payload, "big") == 0:
                        raise MidiRepresentationError("invalid_midi_tempo")
                    event = MidiEvent(
                        position,
                        status,
                        meta_type=kind,
                        tempo_bpm=Fraction(60_000_000, int.from_bytes(payload, "big")),
                    )
                else:
                    event = MidiEvent(position, status, payload, kind)
                if kind == 0x2F:
                    if payload:
                        raise MidiRepresentationError("invalid_midi_end_of_track")
                    ended = True
            elif status in (0xF0, 0xF7):
                running = 0
                size, offset = _read_vlq(data, offset)
                payload = data[offset : offset + size]
                if len(payload) != size:
                    raise MidiRepresentationError("truncated_midi_sysex")
                offset += size
                event = MidiEvent(position, status, payload)
            else:
                size = _channel_size(status)
                payload = data[offset : offset + size]
                if len(payload) != size or any(byte >= 128 for byte in payload):
                    raise MidiRepresentationError("invalid_midi_channel_event")
                offset += size
                running = status
                event = MidiEvent(position, status, payload)
            events.append(event)
        if not ended:
            raise MidiRepresentationError("missing_midi_end_of_track")
        tracks.append(tuple(events))
        cursor = end
    if cursor != len(content):
        raise MidiRepresentationError("unexpected_midi_chunk")
    return StandardMidiFile(ppq, tuple(tracks), format)


def serialize_standard_midi(midi: StandardMidiFile) -> bytes:
    if midi.format not in (0, 1) or not midi.tracks or (midi.format == 0 and len(midi.tracks) != 1):
        raise MidiRepresentationError("unsupported_midi_format")
    ppq = exact_output_ppq(midi.ppq, (event.position for track in midi.tracks for event in track))
    output = bytearray(
        b"MThd\x00\x00\x00\x06"
        + midi.format.to_bytes(2, "big")
        + len(midi.tracks).to_bytes(2, "big")
        + ppq.to_bytes(2, "big")
    )
    for track in midi.tracks:
        ordered = sorted(track, key=lambda event: event.position)
        if (
            not ordered
            or ordered[-1].meta_type != 0x2F
            or sum(e.meta_type == 0x2F for e in ordered) != 1
        ):
            raise MidiRepresentationError("invalid_midi_end_of_track")
        # Only binary tempo state is coalesced. Input encounter order determines
        # the last tempo at a tick, without changing canonical plan history.
        last_tempo = {e.position: i for i, e in enumerate(ordered) if e.tempo_bpm is not None}
        body = bytearray()
        previous = 0
        for index, event in enumerate(ordered):
            if event.tempo_bpm is not None and last_tempo[event.position] != index:
                continue
            tick = event.position * ppq
            if tick.denominator != 1:
                raise MidiRepresentationError("unrepresentable_exact_midi_tick")
            body.extend(_vlq(int(tick) - previous))
            previous = int(tick)
            if event.status == 0xFF:
                if event.meta_type is None or not 0 <= event.meta_type < 128:
                    raise MidiRepresentationError("invalid_midi_meta")
                payload = event.data
                if event.meta_type == 0x2F and payload:
                    raise MidiRepresentationError("invalid_midi_end_of_track")
                if event.meta_type == 0x51 and event.tempo_bpm is None:
                    raise MidiRepresentationError("invalid_midi_tempo")
                if event.tempo_bpm is not None:
                    if event.meta_type != 0x51 or event.tempo_bpm <= 0:
                        raise MidiRepresentationError("invalid_midi_tempo")
                    micros = round(Fraction(60_000_000) / event.tempo_bpm)
                    if not 0 < micros < 1 << 24:
                        raise MidiRepresentationError("unrepresentable_midi_tempo")
                    payload = micros.to_bytes(3, "big")
                body.extend(bytes((0xFF, event.meta_type)) + _vlq(len(payload)) + payload)
            elif event.status in (0xF0, 0xF7):
                body.extend(bytes((event.status,)) + _vlq(len(event.data)) + event.data)
            else:
                if len(event.data) != _channel_size(event.status) or any(
                    byte >= 128 for byte in event.data
                ):
                    raise MidiRepresentationError("invalid_midi_channel_event")
                body.extend(bytes((event.status,)) + event.data)
        output.extend(b"MTrk" + len(body).to_bytes(4, "big") + body)
    return bytes(output)
