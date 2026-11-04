"""Exact interval, event identity, state and fail-closed MIDI projection semantics."""

from fractions import Fraction
from unittest.mock import Mock
import base64

import pytest
import verovio

from app.processing.engines.playback.standard_midi import (
    MidiEvent,
    StandardMidiFile,
    MidiRepresentationError,
    parse_standard_midi,
    serialize_standard_midi,
)
from app.processing.engines.playback.performance_midi import project_performance_midi
from app.processing.engines.playback.verovio_midi import VerovioMidiCompiler
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_plan import build_performance_plan
from tests.support.canonical_musicxml import (
    dc_score,
    ds_score,
    score,
    measure,
    jump_measures,
    boundary_tempos,
)


def event(q, status, data=b"", meta=None):
    return MidiEvent(Fraction(q), status, data, meta)


def source(*events, second=None):
    tracks = [
        (event(0, 255, b"conductor", 3), event(16, 255, meta=47)),
        tuple(events) + (event(16, 255, meta=47),),
    ]
    if second is not None:
        tracks.append(tuple(second) + (event(16, 255, meta=47),))
    return StandardMidiFile(120, tuple(tracks))


def project(xml, midi):
    return project_performance_midi(midi, build_performance_plan(parse_score_semantics(xml)))


def channels(midi, status):
    return [
        (i, e.position, e.data) for i, t in enumerate(midi.tracks) for e in t if e.status == status
    ]


def test_active_source_note_terminates_at_exact_jump_and_no_source_onset_after_cut():
    raw = source(
        event(13, 144, b"\x3c\x50"),
        event(15, 128, b"\x3c\x20"),
        event(15, 144, b"\x40\x50"),
        event(16, 128, b"\x40\x20"),
    )
    output = project(dc_score(), raw)
    assert channels(output, 144) == [(1, 13, b"\x3c\x50")]
    assert channels(output, 128) == [(1, 14, b"\x3c\x00")]
    assert channels(output, 176) == []
    assert all(t[-1].position == 20 for t in output.tracks)


def test_partial_destination_never_retriggers_a_preceding_onset():
    raw = source(
        event(4, 144, b"\x3c\x50"),
        event(5, 144, b"\x40\x50"),
        event(6, 128, b"\x40\x00"),
        event(7, 128, b"\x3c\x00"),
    )
    output = project(ds_score(), raw)
    assert channels(output, 144) == [(1, 4, b"\x3c\x50"), (1, 5, b"\x40\x50"), (1, 15, b"\x40\x50")]
    assert channels(output, 128) == [(1, 6, b"\x40\x00"), (1, 7, b"\x3c\x00"), (1, 16, b"\x40\x00")]


def test_note_can_cross_a_continuous_measure_boundary_without_retrigger_or_cut():
    raw = source(event(2, 144, b"\x3c\x50"), event(6, 128, b"\x3c\x20"))
    output = project(score([measure(0), measure(1)]), raw)
    assert channels(output, 128) == [(1, 6, b"\x3c\x20")]


def test_program_controller_pitch_and_meta_state_follow_actual_encounters():
    raw = source(
        event(0, 192, b"\x05"),
        event(1, 176, b"\x07\x64"),
        event(2, 224, b"\x01\x40"),
        event(3, 255, b"lyric", 5),
        event(5, 192, b"\x06"),
    )
    output = project(score(jump_measures("yes")), raw)
    assert channels(output, 192) == [
        (1, 0, b"\x05"),
        (1, 5, b"\x06"),
        (1, 8, b"\x05"),
        (1, 13, b"\x06"),
        (1, 22, b"\x05"),
        (1, 27, b"\x06"),
        (1, 30, b"\x05"),
        (1, 35, b"\x06"),
    ]
    assert [q for _, q, _ in channels(output, 176)] == [1, 9, 23, 31]
    assert [q for _, q, _ in channels(output, 224)] == [2, 10, 24, 32]
    assert [e.position for e in output.tracks[1] if e.meta_type == 5] == [3, 11, 25, 33]


def test_destination_does_not_restore_historical_program_or_controller_state():
    raw = source(
        event(1, 192, b"\x03"),
        event(2, 176, b"\x40\x7f"),
        event(13, 192, b"\x07"),
        event(14, 144, b"\x3c\x50"),
        event(16, 128, b"\x3c\x00"),
    )
    output = project(ds_score(), raw)
    assert channels(output, 192) == [(1, 1, b"\x03"), (1, 13, b"\x07")]
    assert channels(output, 176) == [(1, 2, b"\x40\x7f")]
    assert channels(output, 128) == [(1, 15, b"\x3c\x00")]


def test_source_endpoint_state_precedes_destination_state_at_same_performance_position():
    raw = source(event(0, 192, b"\x03"), event(14, 192, b"\x07"))
    output = project(dc_score(), raw)
    assert channels(output, 192) == [(1, 0, b"\x03"), (1, 14, b"\x07"), (1, 14, b"\x03")]


def test_track_channel_identity_and_ordinary_pressure_events_are_preserved():
    raw = source(
        event(0, 192, b"\x05"),
        event(1, 144, b"\x3c\x50"),
        event(2, 160, b"\x3c\x20"),
        event(3, 128, b"\x3c\x20"),
        second=[
            event(0, 193, b"\x06"),
            event(1, 145, b"\x3c\x60"),
            event(2, 209, b"\x20"),
            event(3, 129, b"\x3c\x30"),
        ],
    )
    output = project(score([measure(0)]), raw)
    assert len(output.tracks) == 3
    assert channels(output, 144) == [(1, 1, b"\x3c\x50")]
    assert channels(output, 145) == [(2, 1, b"\x3c\x60")]
    assert channels(output, 160) == [(1, 2, b"\x3c\x20")]
    assert channels(output, 209) == [(2, 2, b"\x20")]


def test_output_ppq_includes_canonical_denominators_even_with_no_boundary_note():
    xml = score([measure(0)]).replace("<divisions>1", "<divisions>7")
    output = project(
        xml, source(event(0, 144, b"\x3c\x50"), event(Fraction(1, 8), 128, b"\x3c\x00"))
    )
    assert output.ppq == 840
    decoded = parse_standard_midi(serialize_standard_midi(output))
    assert decoded.tracks[1][1].position == Fraction(1, 8)
    assert decoded.tracks[1][-1].position == Fraction(4, 7)


def test_unrepresentable_plan_boundary_fails_instead_of_rounding():
    xml = score([measure(0)]).replace("<divisions>1", "<divisions>32771")
    with pytest.raises(MidiRepresentationError, match="unrepresentable_exact_midi_ppq"):
        project(xml, source())


@pytest.mark.parametrize(
    "events,error",
    [
        ([event(0, 240, b"\x01")], "unsupported_midi_event"),
        ([event(0, 255, b"x", 127)], "unsupported_midi_meta_event"),
        ([event(0, 255, b"\0" * 5, 84)], "unsupported_midi_meta_event"),
        ([event(0, 255, b"\x01", 33)], "unsupported_midi_port"),
        ([event(0, 176, b"\x7c\x00")], "unsupported_midi_channel_mode"),
        ([event(1, 128, b"\x3c\0")], "unmatched_midi_note_off"),
        ([event(1, 144, b"\x3c\x50")], "unterminated_written_midi_note"),
        (
            [event(0, 144, b"\x3c\x50"), event(1, 144, b"\x3c\x50")],
            "ambiguous_overlapping_midi_note",
        ),
        ([event(17, 192, b"\x01")], "midi_event_outside_written_score"),
    ],
)
def test_unsupported_or_ambiguous_input_is_not_dropped(events, error):
    with pytest.raises(MidiRepresentationError, match=error):
        project(dc_score(), source(*events))


def test_shared_channel_programs_replay_in_one_ordered_stream():
    result = project(dc_score(), source(event(1, 192, b"\x01"), second=[event(1, 192, b"\x02")]))
    assert channels(result, 192) == [
        (1, 1, b"\x01"),
        (1, 1, b"\x02"),
        (1, 15, b"\x01"),
        (1, 15, b"\x02"),
    ]


def test_zero_duration_boundary_note_is_explicitly_unsupported():
    raw = source(event(4, 144, b"\x3c\x50"), event(4, 128, b"\x3c\x00"))
    with pytest.raises(MidiRepresentationError, match="unsupported_zero_duration_midi_note"):
        project(dc_score(), raw)


def test_smf_state_without_boundary_side_identity_fails_when_encounter_mappings_differ():
    with pytest.raises(MidiRepresentationError, match="ambiguous_midi_boundary_state"):
        project(boundary_tempos(), source(event(8, 192, b"\x01")))


def test_compiler_requests_written_realization_and_fails_without_renderer_fallback(monkeypatch):
    invalid = serialize_standard_midi(source(event(1, 240, b"\x01")))
    toolkit = Mock()
    toolkit.loadData.return_value = True
    toolkit.renderToMIDI.return_value = base64.b64encode(invalid).decode()
    for method in ("getMEI", "renderToTimemap", "renderToExpansionMap"):
        getattr(toolkit, method).side_effect = AssertionError("Not a traversal authority")
    monkeypatch.setattr(verovio, "toolkit", lambda: toolkit)
    with pytest.raises(RuntimeError, match="score_playback_failed") as exc:
        VerovioMidiCompiler().compile(dc_score().encode())
    assert isinstance(exc.value.__cause__, MidiRepresentationError)
    assert str(exc.value.__cause__) == "unsupported_midi_event"
    toolkit.setOptions.assert_called_once_with({"inputFrom": "xml", "expandNever": True})
