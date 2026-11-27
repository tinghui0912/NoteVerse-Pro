"""SMF syntax and the one exact quarter-to-tick encoding policy."""

from fractions import Fraction

import pytest

from app.processing.engines.playback.standard_midi import (
    MidiEvent,
    StandardMidiFile,
    MidiRepresentationError,
    parse_standard_midi,
    serialize_standard_midi,
    exact_output_ppq,
)


def smf(track, division=120, format=0):
    return (
        b"MThd\0\0\0\x06"
        + format.to_bytes(2, "big")
        + b"\0\x01"
        + division.to_bytes(2, "big")
        + b"MTrk"
        + len(track).to_bytes(4, "big")
        + track
    )


def test_binary_decode_running_status_velocity_zero_and_stable_channel_messages():
    raw = smf(
        b"\x00\xc2\x05\x00\xb2\x07\x64\x00\xe2\x00\x40\x00\x92\x3c\x50\x78\x3c\x00\x00\xff\x2f\x00"
    )
    parsed = parse_standard_midi(raw)
    assert [(e.position, e.status, e.data) for e in parsed.tracks[0][:-1]] == [
        (0, 0xC2, b"\x05"),
        (0, 0xB2, b"\x07\x64"),
        (0, 0xE2, b"\x00\x40"),
        (0, 0x92, b"\x3c\x50"),
        (1, 0x92, b"\x3c\x00"),
    ]
    assert parse_standard_midi(serialize_standard_midi(parsed)) == parsed


def test_lcm_preserves_input_ticks_and_rational_boundaries_without_rounding():
    assert exact_output_ppq(120, [Fraction(1, 7), Fraction(4, 3)]) == 840
    source = StandardMidiFile(
        120,
        (
            (
                MidiEvent(Fraction(1, 7), 0x90, b"\x3c\x50"),
                MidiEvent(Fraction(2, 7), 0x80, b"\x3c\x00"),
                MidiEvent(Fraction(4, 3), 0xFF, meta_type=47),
            ),
        ),
    )
    result = parse_standard_midi(serialize_standard_midi(source))
    assert result.ppq == 840
    assert [e.position for e in result.tracks[0]] == [
        Fraction(1, 7),
        Fraction(2, 7),
        Fraction(4, 3),
    ]


@pytest.mark.parametrize(
    "ppq,positions,error",
    [
        (0, [], "unsupported_midi_division"),
        (0x8001, [], "unsupported_midi_division"),
        (120, [Fraction(1, 32771)], "unrepresentable_exact_midi_ppq"),
        (120, [Fraction(-1, 3)], "negative_midi_position"),
    ],
)
def test_unrepresentable_ticks_are_rejected(ppq, positions, error):
    with pytest.raises(MidiRepresentationError, match=error):
        exact_output_ppq(ppq, positions)


@pytest.mark.parametrize(
    "raw",
    [
        b"MThd",
        smf(b"\x00\x3c\x40\x00\xff\x2f\x00"),
        smf(b"\x81\x81\x81\x81\x00\xff\x2f\x00"),
        smf(b"\x00\x90\x3c"),
        smf(b"\x00\xff\x03\x03a"),
        smf(b"\x00\xf0\x02a"),
        smf(b"\x00\xff\x51\x03\0\0\0\x00\xff\x2f\x00"),
        smf(b"\x00\xff\x2f\x01a"),
        smf(b"\x00\xff\x2f\x00\x00\xc0\x01"),
        smf(b"\x00\xc0\x01"),
        smf(b"\x00\xff\x2f\x00", division=0xE728),
        smf(b"\x00\xff\x2f\x00", format=2),
        smf(b"\x00\xff\x2f\x00") + b"extra",
    ],
)
def test_malformed_and_unsupported_smf_layouts_fail_closed(raw):
    with pytest.raises(MidiRepresentationError):
        parse_standard_midi(raw)


def test_same_quarter_tempo_serialization_uses_last_state_and_retains_other_order():
    source = StandardMidiFile(
        120,
        (
            (
                MidiEvent(Fraction(0), 255, meta_type=81, tempo_bpm=Fraction(80)),
                MidiEvent(Fraction(0), 255, meta_type=81, tempo_bpm=Fraction(100)),
                MidiEvent(Fraction(0), 255, b"source", 1),
                MidiEvent(Fraction(0), 255, b"destination", 1),
                MidiEvent(Fraction(1), 255, meta_type=47),
            ),
        ),
    )
    track = parse_standard_midi(serialize_standard_midi(source)).tracks[0]
    assert [e.tempo_bpm for e in track if e.tempo_bpm] == [100]
    assert [e.data for e in track if e.meta_type == 1] == [b"source", b"destination"]
