"""Independent realization state and deterministic synthesis channel allocation."""

from fractions import Fraction

import pytest

from app.processing.engines.playback.performance_midi import project_performance_midi
from app.processing.engines.playback.standard_midi import (
    MidiEvent,
    MidiRepresentationError,
    StandardMidiFile,
    parse_standard_midi,
    serialize_standard_midi,
)
from app.processing.engines.playback.written_midi_streams import (
    WrittenMidiStreamId,
    allocate_output_channels,
    read_written_midi_streams,
)
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_plan import build_performance_plan
from tests.support.canonical_musicxml import dc_score, ds_score, measure, score


def event(q, status, data):
    return MidiEvent(Fraction(q), status, bytes(data))


def written(*tracks):
    return StandardMidiFile(
        120, tuple(tuple(t) + (MidiEvent(Fraction(16), 255, meta_type=47),) for t in tracks)
    )


def perform(xml, midi):
    plan = build_performance_plan(parse_score_semantics(xml))
    return parse_standard_midi(serialize_standard_midi(project_performance_midi(midi, plan)))


def channel_messages(track):
    return [(e.position, e.status, e.data) for e in track if e.status < 240]


def test_all_channel_voice_types_and_cut_releases_use_the_same_stream_routing():
    state = [
        event(0, 192, (40,)),
        event(1, 176, (64, 127)),
        event(2, 224, (0, 65)),
        event(3, 208, (70,)),
        event(13, 144, (60, 100)),
        event(13, 160, (60, 80)),
        event(16, 128, (60, 25)),
    ]
    first = [event(0, 192, (0,)), event(13, 144, (60, 90)), event(16, 128, (60, 20))]
    raw = written([], first, state)
    streams = read_written_midi_streams(raw)
    assert streams.stream_ids == (WrittenMidiStreamId(1, 0), WrittenMidiStreamId(2, 0))
    for xml, cut in ((dc_score(), 14), (ds_score(), 15)):
        result = perform(xml, raw)
        for track, channel in ((1, 0), (2, 1)):
            messages = channel_messages(result.tracks[track])
            assert {status & 15 for _, status, _ in messages} == {channel}
            assert (Fraction(cut), 128 | channel, bytes((60, 0))) in messages
        assert channel_messages(result.tracks[2])[:6] == [
            (e.position, (e.status & 240) | 1, e.data) for e in state[:6]
        ]
        assert [e.data for e in result.tracks[2] if e.status & 240 == 176] == [bytes((64, 127))] * (
            2 if cut == 14 else 1
        )


def test_real_channel_mode_event_only_changes_its_logical_stream():
    result = perform(
        ds_score(),
        written(
            [],
            [event(13, 144, (60, 90)), event(16, 128, (60, 0))],
            [event(13, 144, (60, 90)), event(14, 176, (123, 0)), event(16, 128, (60, 0))],
        ),
    )
    assert channel_messages(result.tracks[1]) == [
        (13, 144, bytes((60, 90))),
        (15, 128, bytes((60, 0))),
    ]
    assert channel_messages(result.tracks[2]) == [
        (13, 145, bytes((60, 90))),
        (14, 177, bytes((123, 0))),
    ]


def test_multiple_source_channels_in_one_track_keep_their_streams_and_source_order():
    raw = written(
        [],
        [
            event(0, 192, (0,)),
            event(0, 194, (40,)),
            event(1, 144, (60, 90)),
            event(1, 146, (60, 90)),
            event(2, 128, (60, 0)),
            event(2, 130, (60, 0)),
        ],
        [event(0, 192, (50,)), event(1, 144, (60, 90)), event(2, 128, (60, 0))],
    )
    result = perform(score([measure(0)]), raw)
    assert channel_messages(result.tracks[1]) == channel_messages(raw.tracks[1])
    assert channel_messages(result.tracks[2]) == [
        (0, 193, bytes((50,))),
        (1, 145, bytes((60, 90))),
        (2, 129, bytes((60, 0))),
    ]


def test_allocator_preserves_distinct_requests_then_assigns_collisions_deterministically():
    ids = [WrittenMidiStreamId(1, 2), WrittenMidiStreamId(2, 2), WrittenMidiStreamId(3, 0)]
    expected = {ids[0]: 2, ids[1]: 1, ids[2]: 0}
    assert allocate_output_channels(ids) == expected
    assert allocate_output_channels(reversed(ids)) == expected


def test_all_melodic_channels_are_independent_and_never_use_gm_percussion():
    ids = [WrittenMidiStreamId(i, 0) for i in range(15)]
    assignments = allocate_output_channels(ids)
    assert set(assignments.values()) == set(range(16)) - {9}
    with pytest.raises(MidiRepresentationError, match="insufficient_output_midi_channels"):
        allocate_output_channels(ids + [WrittenMidiStreamId(15, 0)])


def test_channel_exhaustion_fails_in_actual_projection():
    raw = written(*([event(0, 192, (i,))] for i in range(16)))
    with pytest.raises(MidiRepresentationError, match="insufficient_output_midi_channels"):
        perform(score([measure(0)]), raw)


def test_unvisited_streams_do_not_consume_final_synthesis_channels():
    raw = written(
        [],
        *([event(15, 144, (60, 90)), event(16, 128, (60, 0))] for _ in range(16)),
    )
    result = perform(dc_score(), raw)
    assert all(not channel_messages(track) for track in result.tracks)
    assert all(track[-1].position == 20 for track in result.tracks)


def test_one_percussion_stream_keeps_channel_nine_beside_fifteen_melodic_streams():
    ids = [WrittenMidiStreamId(i, 0) for i in range(15)] + [WrittenMidiStreamId(15, 9)]
    assignments = allocate_output_channels(ids)
    assert assignments[ids[-1]] == 9
    assert len(set(assignments.values())) == 16
    raw = written(
        [],
        [event(0, 201, (0,)), event(1, 153, (36, 90)), event(3, 137, (36, 0))],
        [event(1, 144, (36, 90)), event(3, 128, (36, 0))],
    )
    result = perform(score([measure(0)]), raw)
    assert channel_messages(result.tracks[1]) == channel_messages(raw.tracks[1])
    assert {e.status & 15 for e in result.tracks[2] if e.status < 240} == {0}


def test_independent_percussion_streams_fail_without_melodic_routing_fallback():
    raw = written([event(0, 201, (0,))], [event(0, 201, (8,))])
    with pytest.raises(MidiRepresentationError, match="unsupported_multiple_percussion_streams"):
        perform(score([measure(0)]), raw)
