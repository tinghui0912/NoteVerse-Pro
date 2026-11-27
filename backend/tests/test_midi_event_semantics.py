"""Structural identity, encountered timeline facts and unmodified channel state."""

from fractions import Fraction

import pytest

from app.processing.engines.playback.standard_midi import (
    MidiEvent,
    StandardMidiFile,
    MidiRepresentationError,
    parse_standard_midi,
    serialize_standard_midi,
)
from app.processing.engines.playback.performance_midi import project_performance_midi
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_plan import build_performance_plan
from tests.support.canonical_musicxml import score, measure, VISIBLE, backward, dc_score, ds_score
from tests.support.midi_observations import channel_events


STRUCTURAL = {
    0x00: b"\x00\x01",
    0x02: b"Copyright",
    0x03: b"Track",
    0x04: b"Piano",
    0x08: b"Program",
    0x09: b"Device",
}
TIMELINE = {
    0x01: b"Text",
    0x05: b"Lyric",
    0x06: b"Marker",
    0x07: b"Cue",
    0x58: bytes((4, 2, 24, 8)),
    0x59: b"\x00\x00",
}


def ev(q, status, data=b"", kind=None):
    return MidiEvent(Fraction(q), status, data, kind)


def midi(*tracks):
    return StandardMidiFile(120, tuple(tuple(t) + (ev(16, 255, kind=47),) for t in tracks))


def final(xml, written):
    return serialize_standard_midi(
        project_performance_midi(written, build_performance_plan(parse_score_semantics(xml)))
    )


@pytest.mark.parametrize(
    "xml,repeat_positions",
    [
        (score([measure(0, {0: VISIBLE}), measure(1, {4: backward()})]), [1, 9]),
        (dc_score(), [1, 15]),
    ],
)
def test_structural_descriptors_once_and_timeline_metadata_per_encounter(xml, repeat_positions):
    written = midi(
        [ev(0, 255, b"Conductor", 3)],
        [ev(0, 255, payload, kind) for kind, payload in STRUCTURAL.items()]
        + [ev(1, 255, payload, kind) for kind, payload in TIMELINE.items()],
    )
    result = parse_standard_midi(final(xml, written))
    assert [(e.position, e.data) for e in result.tracks[0] if e.meta_type == 3] == [
        (0, b"Conductor")
    ]
    for kind, payload in STRUCTURAL.items():
        assert [(e.position, e.data) for e in result.tracks[1] if e.meta_type == kind] == [
            (0, payload)
        ]
    for kind, payload in TIMELINE.items():
        assert [(e.position, e.data) for e in result.tracks[1] if e.meta_type == kind] == [
            (Fraction(q), payload) for q in repeat_positions
        ]


@pytest.mark.parametrize("kind,payload", STRUCTURAL.items())
def test_structural_descriptors_outside_origin_fail_without_relocation(kind, payload):
    with pytest.raises(MidiRepresentationError, match="unsupported_structural_midi_position"):
        final(dc_score(), midi([ev(1, 255, payload, kind)]))


def test_naturally_released_notes_at_repeat_and_final_end_create_no_channel_state():
    xml = score([measure(0, {0: VISIBLE}), measure(1, {4: backward()})])
    result = final(xml, midi([], [ev(1, 144, b"\x3c\x50"), ev(2, 128, b"\x3c\x20")]))
    assert channel_events(result) == [
        (1, Fraction(1), 144, b"\x3c\x50"),
        (1, Fraction(2), 128, b"\x3c\x20"),
        (1, Fraction(9), 144, b"\x3c\x50"),
        (1, Fraction(10), 128, b"\x3c\x20"),
    ]


def test_active_jump_cut_generates_only_note_release_and_sustain_carries():
    result = final(
        ds_score(),
        midi([], [ev(2, 176, b"\x40\x7f"), ev(13, 144, b"\x3c\x50"), ev(16, 128, b"\x3c\x20")]),
    )
    assert channel_events(result) == [
        (1, Fraction(2), 176, b"\x40\x7f"),
        (1, Fraction(13), 144, b"\x3c\x50"),
        (1, Fraction(15), 128, b"\x3c\x00"),
    ]


def test_note_release_in_a_different_logical_stream_cannot_pair():
    with pytest.raises(MidiRepresentationError, match="unterminated_written_midi_note"):
        final(
            dc_score(),
            midi([], [ev(3, 144, b"\x3c\x50")], [ev(4, 128, b"\x3c\x20")]),
        )


def test_different_streams_keep_source_and_destination_state_independent():
    result = final(dc_score(), midi([], [ev(0, 192, b"\x03")], [ev(14, 192, b"\x07")]))
    assert channel_events(result) == [
        (1, Fraction(0), 192, b"\x03"),
        (1, Fraction(14), 192, b"\x03"),
        (2, Fraction(14), 193, b"\x07"),
    ]


@pytest.mark.parametrize("controller,value", [(64, 127), (120, 0), (121, 0), (123, 0)])
def test_real_controller_commands_replay_without_additional_channel_policy(controller, value):
    data = bytes((controller, value))
    result = final(dc_score(), midi([], [ev(2, 176, data)]))
    assert channel_events(result) == [(1, Fraction(2), 176, data), (1, Fraction(16), 176, data)]


def test_duplicate_track_descriptor_is_not_arbitrarily_selected():
    with pytest.raises(MidiRepresentationError, match="ambiguous_structural_midi_descriptor"):
        final(dc_score(), midi([ev(0, 255, b"First", 3), ev(0, 255, b"Second", 3)]))


def test_file_descriptors_keep_origin_order_before_the_canonical_conductor():
    written = midi([ev(0, 255, b"\x00\x01", 0), ev(0, 255, b"Copyright", 2)])
    result = parse_standard_midi(final(dc_score(), written))
    assert [(e.position, e.meta_type) for e in result.tracks[0]] == [
        (0, 0),
        (0, 2),
        (0, 0x51),
        (20, 0x2F),
    ]


def test_cross_track_same_key_notes_have_independent_lifecycles():
    written = midi(
        [],
        [ev(1, 144, b"\x3c\x50"), ev(3, 128, b"\x3c\x00")],
        [ev(1, 144, b"\x3c\x60"), ev(3, 128, b"\x3c\x00")],
    )
    events = channel_events(final(dc_score(), written))
    assert [
        (track, q, status & 15) for track, q, status, data in events if status & 240 == 144
    ] == [(1, 1, 0), (1, 15, 0), (2, 1, 1), (2, 15, 1)]


@pytest.mark.parametrize("kind,payload", [(0x20, b"\x00"), (0x21, b"\x00"), (0x21, b"\x01")])
def test_unmodeled_routing_metadata_fails_instead_of_retaining_stale_routing(kind, payload):
    with pytest.raises(MidiRepresentationError, match="unsupported_midi_routing_metadata"):
        final(dc_score(), midi([ev(0, 255, payload, kind)]))
