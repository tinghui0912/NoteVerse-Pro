"""Observed Python Verovio 6.3.0 source fidelity, using the WASM source fixtures."""

import base64
from fractions import Fraction

import pytest
import verovio

from app.processing.engines.playback.standard_midi import parse_standard_midi
from tests.support.written_realization_sources import (
    SOURCES,
    LOSSY_SOUND_CONTROLS,
    LOSSY_INSTRUMENT_CONTROLS,
    SWING_SOURCE,
    with_sound,
    with_origin_instrument_state,
    PROFILE_SOURCES,
)


def render(xml):
    toolkit = verovio.toolkit()
    assert toolkit.getVersion().startswith("6.3.0")
    assert toolkit.setOptions({"inputFrom": "xml", "expandNever": True})
    assert toolkit.loadData(xml)
    return parse_standard_midi(base64.b64decode(toolkit.renderToMIDI()))


@pytest.mark.parametrize(
    "name,velocities,pitches,programs,controllers",
    [
        ("piano", [90, 90], [60, 60], [(1, 0, 0)], []),
        ("duet", [90] * 4, [60] * 4, [(1, 0, 0), (2, 0, 40)], []),
        ("dynamics", [27, 81], [60, 60], [(1, 0, 0)], []),
        ("directionDynamics", [90, 90], [60, 60], [(1, 0, 0)], []),
        ("microtonal", [90, 90], [60, 60], [(1, 0, 0)], []),
        ("multipleInstruments", [90, 90], [60, 60], [(1, 0, 0)], []),
        ("pedal", [90, 90], [60, 60], [(1, 0, 0)], [(64, 127), (64, 0)]),
    ],
)
def test_python_written_realization_matches_wasm_observations(
    name, velocities, pitches, programs, controllers
):
    written = render(SOURCES[name])
    events = [(i, e) for i, t in enumerate(written.tracks) for e in t if e.status < 240]
    notes = [e for _, e in events if e.status & 240 == 144 and e.data[1]]
    assert [e.data[1] for e in notes] == velocities
    assert [e.data[0] for e in notes] == pitches
    assert [(i, e.status & 15, e.data[0]) for i, e in events if e.status & 240 == 192] == programs
    assert [tuple(e.data) for _, e in events if e.status & 240 == 176] == controllers
    assert not any(e.status & 240 in (160, 208, 224) for _, e in events)


@pytest.mark.parametrize(
    "xml",
    [with_sound(s) for s in LOSSY_SOUND_CONTROLS]
    + [with_origin_instrument_state(s) for s in LOSSY_INSTRUMENT_CONTROLS],
)
def test_adjacent_sound_and_instrument_controls_do_not_reach_python_written_midi(xml):
    assert render(xml) == render(SOURCES["piano"])


def test_sound_swing_does_not_shift_eighth_note_onsets():
    written = render(SWING_SOURCE)
    assert [
        e.position for t in written.tracks for e in t if e.status & 240 == 144 and e.data[1]
    ] == [Fraction(0), Fraction(1, 2)]


@pytest.mark.parametrize("name,case", PROFILE_SOURCES.items(), ids=PROFILE_SOURCES)
def test_python_profile_realization_has_the_shared_wasm_trace(name, case):
    toolkit = verovio.toolkit()
    assert toolkit.getVersion().startswith("6.3.0")
    assert toolkit.setOptions({"inputFrom": "xml", "expandNever": True})
    assert toolkit.loadData(case["musicxml"])
    written = parse_standard_midi(base64.b64decode(toolkit.renderToMIDI()))
    assert {
        "ppq": written.ppq,
        "trackCount": len(written.tracks),
        "channelEvents": [
            [i, int(e.position * written.ppq), e.status, list(e.data)]
            for i, track in enumerate(written.tracks)
            for e in track
            if e.status < 240
        ],
        "routingMeta": [
            [i, int(e.position * written.ppq), e.meta_type, list(e.data)]
            for i, track in enumerate(written.tracks)
            for e in track
            if e.meta_type in (9, 32, 33)
        ],
    } == case["expected"]
    assert [[e["qstamp"], e["on"]] for e in toolkit.renderToTimemap() if e.get("on")] == case[
        "visualOnsets"
    ]
