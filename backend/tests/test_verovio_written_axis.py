"""Real renderer evidence for written-axis note extraction, not domain authority."""

import base64
from fractions import Fraction

import pytest
from tests.support.midi_observations import midi_note_ons
import verovio

from tests.support.canonical_musicxml import dc_score
from tests.support.canonical_musicxml import measure, score, INVISIBLE, backward, VISIBLE


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
