"""Real renderer evidence for written-axis note extraction, not domain authority."""

import base64
from fractions import Fraction

import pytest
import verovio

from tests.test_exact_jump_navigation import dc_score
from tests.test_invisible_forward_repeats import measure, score, INVISIBLE, backward, VISIBLE


def midi_note_ons(midi):
    """Read note-on ticks from the renderer's SMF without interpreting navigation."""
    ppq = int.from_bytes(midi[12:14], "big")
    cursor = 14
    notes = []
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
                if status & 240 == 144 and midi[position + 1] > 0:
                    notes.append(Fraction(tick, ppq))
                position += size
        cursor = end
    return notes


@pytest.mark.parametrize(
    "xml,count",
    [
        (score([measure(0, {0: VISIBLE}), measure(1, {4: backward()})]), 8),
        (dc_score(), 16),
        (score([measure(0), measure(1, {0: INVISIBLE}), measure(2, {4: backward()})]), 12),
    ],
)
def test_expand_never_keeps_real_midi_and_timemap_on_written_axis(xml, count):
    toolkit = verovio.toolkit()
    assert toolkit.setOptions({"inputFrom": "xml", "expandNever": True})
    assert toolkit.loadData(xml)
    midi = base64.b64decode(toolkit.renderToMIDI())
    timing = toolkit.renderToTimemap()
    assert midi_note_ons(midi) == list(map(Fraction, range(count)))
    assert [e["qstamp"] for e in timing if e.get("on")] == list(range(count))
    assert [e["on"][0] for e in timing if e.get("on")] == [
        f"n{i // 4}_{i % 4}" for i in range(count)
    ]
    assert max(e["qstamp"] for e in timing) == count
