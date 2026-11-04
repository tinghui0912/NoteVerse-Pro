"""Independent binary observations of emitted MIDI for contract tests."""

from fractions import Fraction


def conductor_events(midi):
    ppq = int.from_bytes(midi[12:14], "big")
    data = midi[22 : 22 + int.from_bytes(midi[18:22], "big")]
    position = tick = 0
    events = []

    def vlq():
        nonlocal position
        result = 0
        while True:
            value = data[position]
            position += 1
            result = (result << 7) | (value & 127)
            if value < 128:
                return result

    while position < len(data):
        tick += vlq()
        assert data[position] == 255
        kind = data[position + 1]
        position += 2
        length = vlq()
        if kind == 81:
            events.append(
                (
                    Fraction(tick, ppq),
                    60_000_000 / int.from_bytes(data[position : position + length], "big"),
                )
            )
        position += length
    return events


def channel_events(midi):
    """Observe final channel messages independently of the production codec."""
    ppq = int.from_bytes(midi[12:14], "big")
    cursor = 14
    notes = []
    track_index = 0
    while cursor < len(midi):
        assert midi[cursor : cursor + 4] == b"MTrk"
        end = cursor + 8 + int.from_bytes(midi[cursor + 4 : cursor + 8], "big")
        position = cursor + 8
        tick = running = 0

        def vlq():
            nonlocal position
            value = 0
            while True:
                byte = midi[position]
                position += 1
                value = (value << 7) | (byte & 127)
                if byte < 128:
                    return value

        while position < end:
            tick += vlq()
            status = midi[position]
            if status >= 128:
                position += 1
            else:
                status = running
            if status == 255:
                position += 1
                size = vlq()
                position += size
            elif status in (240, 247):
                size = vlq()
                position += size
            else:
                running = status
                size = 1 if status & 240 in (192, 208) else 2
                notes.append(
                    (track_index, Fraction(tick, ppq), status, midi[position : position + size])
                )
                position += size
        cursor = end
        track_index += 1
    return notes


def midi_note_ons(midi):
    return [
        position
        for _, position, status, data in channel_events(midi)
        if status & 240 == 144 and data[1] > 0
    ]
