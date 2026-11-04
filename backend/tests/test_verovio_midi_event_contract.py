"""Observed Verovio 6.3.0 structural metadata and multi-part channel layout."""

import base64
from fractions import Fraction

import pytest
import verovio

from app.processing.engines.playback.standard_midi import parse_standard_midi
from app.processing.engines.playback.standard_midi import MidiRepresentationError
from app.processing.engines.playback.verovio_midi import VerovioMidiCompiler
from tests.support.multipart_musicxml import multipart_musicxml, multipart_stream_musicxml
from tests.support.midi_observations import channel_events


@pytest.mark.parametrize("same_pitch", [False, True])
@pytest.mark.parametrize("assignments", [None, (3, 7), (3, 3)])
@pytest.mark.parametrize("navigation", ["linear", "repeat", "dc", "ds"])
def test_real_streams_keep_program_state_for_later_notes(same_pitch, assignments, navigation):
    xml = multipart_stream_musicxml(assignments, same_pitch=same_pitch, navigation=navigation)
    final = VerovioMidiCompiler().compile(xml.encode()).content
    events = channel_events(final)
    programs = {}
    observations = []
    for track, q, status, data in sorted(events, key=lambda e: (e[1], e[0])):
        channel = status & 15
        if status & 240 == 192:
            programs[channel] = data[0]
        elif status & 240 == 144 and data[1]:
            observations.append((track, q, channel, programs[channel], data[0]))
    end = {"linear": 8, "repeat": 16, "dc": 20, "ds": 20}[navigation]
    for track, program, pitch in ((1, 0, 60), (2, 40, 60 if same_pitch else 64)):
        notes = [item for item in observations if item[0] == track]
        assert [(q, p, key) for _, q, _, p, key in notes] == [
            (Fraction(q), program, pitch) for q in range(end)
        ]
    assert {c for track, _, c, _, _ in observations if track == 1}.isdisjoint(
        {c for track, _, c, _, _ in observations if track == 2}
    )
    assert all(t[-1].position == end for t in parse_standard_midi(final).tracks)


@pytest.mark.parametrize("navigation,cut", [("dc", 14), ("ds", 15)])
def test_real_shared_pitch_streams_cut_only_their_own_notes(navigation, cut):
    xml = multipart_stream_musicxml(same_pitch=True, navigation=navigation, sustained=True)
    final = VerovioMidiCompiler().compile(xml.encode()).content
    events = channel_events(final)
    for track, channel in ((1, 0), (2, 1)):
        at_cut = [(q, status, data) for t, q, status, data in events if t == track and q == cut]
        expected = [(Fraction(cut), 128 | channel, b"\x3c\x00")]
        if navigation == "dc":
            expected += [
                (Fraction(cut), 192 | channel, bytes((0 if track == 1 else 40,))),
                (Fraction(cut), 144 | channel, b"\x3c\x5a"),
            ]
        assert at_cut == expected
        assert (track, Fraction(20), 128 | channel, b"\x3c\x00") in events
        assert {status & 15 for t, _, status, _ in events if t == track} == {channel}
    assert final == VerovioMidiCompiler().compile(xml.encode()).content


@pytest.mark.parametrize(
    "assignments,channels",
    [(None, (0, 0)), ((3, 7), (2, 6)), ((3, 3), (2, 2)), ((10, 3), (9, 2)), ((10, 10), (9, 9))],
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
    "assignments,channels", [(None, (0, 1)), ((3, 7), (2, 6)), ((3, 3), (2, 0)), ((10, 3), (9, 2))]
)
def test_final_multipart_playback_allocates_independent_channels_and_preserves_tracks(
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


def test_real_multiple_percussion_streams_have_an_explicit_synthesis_capability_error():
    with pytest.raises(RuntimeError, match="score_playback_failed") as exc:
        VerovioMidiCompiler().compile(multipart_musicxml((10, 10)).encode())
    assert isinstance(exc.value.__cause__, MidiRepresentationError)
    assert str(exc.value.__cause__) == "unsupported_multiple_percussion_streams"
