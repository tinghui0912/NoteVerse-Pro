"""Observed Verovio 6.3.0 structural metadata and multi-part channel layout."""

import base64
from fractions import Fraction

import pytest
import verovio

from app.processing.engines.playback.standard_midi import parse_standard_midi
from app.processing.engines.playback.verovio_midi import VerovioMidiCompiler
from tests.support.multipart_musicxml import multipart_musicxml
from tests.support.midi_observations import channel_events


@pytest.mark.parametrize(
    "assignments,channels", [(None, (0, 0)), ((3, 7), (2, 6)), ((3, 3), (2, 2))]
)
def test_real_written_multipart_metadata_channel_and_program_contract(assignments, channels):
    xml = multipart_musicxml(assignments)
    toolkit = verovio.toolkit()
    toolkit.setOptions({"inputFrom": "xml", "expandNever": True})
    assert toolkit.loadData(xml)
    written = parse_standard_midi(base64.b64decode(toolkit.renderToMIDI()))
    assert toolkit.getVersion().startswith("6.3.0")
    assert written.ppq == 120 and len(written.tracks) == 3
    assert [(e.meta_type, e.position) for e in written.tracks[0]] == [(0x51, 0), (0x2F, 0)]
    for track, channel in enumerate(channels, start=1):
        events = written.tracks[track]
        assert {e.status & 15 for e in events if e.status < 240} == {channel}
        assert [
            (e.meta_type, e.position, e.data) for e in events if e.meta_type not in (None, 0x2F)
        ] == [
            (0x03, Fraction(0), f"Part {track - 1}".encode()),
            (0x58, Fraction(0), bytes((4, 2, 24, 8))),
        ]
        assert [(e.position, e.status, e.data) for e in events if e.status & 240 == 192] == [
            (Fraction(0), 192 | channel, bytes((0 if track == 1 else 40,))),
        ]
        assert not any(e.status & 240 == 176 for e in events)
        assert [(e.position, e.data[0]) for e in events if e.status & 240 == 144 and e.data[1]] == [
            (Fraction(0), 60 if track == 1 else 64),
        ]


@pytest.mark.parametrize(
    "assignments,channels", [(None, (0, 0)), ((3, 7), (2, 6)), ((3, 3), (2, 2))]
)
def test_final_multipart_playback_preserves_source_assignment_and_global_program_encounters(
    assignments, channels
):
    final = VerovioMidiCompiler().compile(multipart_musicxml(assignments).encode()).content
    messages = channel_events(final)
    assert [
        (q, status, data)
        for _, q, status, data in messages
        if status & 240 in (192, 144) and (status & 240 == 192 or data[1])
    ] == [
        (Fraction(0), 192 | channels[0], b"\x00"),
        (Fraction(0), 144 | channels[0], b"\x3c\x5a"),
        (Fraction(0), 192 | channels[1], b"\x28"),
        (Fraction(0), 144 | channels[1], b"\x40\x5a"),
    ]
    parsed = parse_standard_midi(final)
    assert len(parsed.tracks) == 3
    assert [[e.data for e in t if e.meta_type == 3] for t in parsed.tracks] == [
        [],
        [b"Part 0"],
        [b"Part 1"],
    ]
    assert all(t[-1].position == 4 for t in parsed.tracks)
