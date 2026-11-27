"""Final real MIDI traversal agrees with exact canonical navigation, pitch by pitch."""

from fractions import Fraction
import base64

import pytest
import verovio

from app.processing.engines.playback.verovio_midi import VerovioMidiCompiler
from app.processing.engines.playback.standard_midi import parse_standard_midi
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_plan import build_performance_plan
from tests.support.midi_observations import channel_events
from tests.support.canonical_musicxml import (
    score,
    measure,
    VISIBLE,
    INVISIBLE,
    backward,
    dc_score,
    ds_score,
    dc_measures,
    ds_measures,
    jump_measures,
    volta_measures,
    distinctive_pitches,
)


def quarters(start, end):
    return list(range(start, end))


WITNESSES = [
    ("linear", score([measure(0), measure(1)]), quarters(0, 8)),
    ("repeat", score([measure(0, {0: VISIBLE}), measure(1, {4: backward()})]), quarters(0, 8) * 2),
    ("volta12", score(volta_measures()), quarters(0, 8) + quarters(0, 4) + quarters(8, 12)),
    ("volta123", score(volta_measures(3)), quarters(0, 8) * 2 + quarters(0, 4) + quarters(8, 12)),
    ("dc-fine", dc_score(), quarters(0, 14) + quarters(0, 6)),
    ("ds-fine", ds_score(), quarters(0, 15) + quarters(5, 10)),
    ("dc-coda", score(dc_measures()), quarters(0, 14) + quarters(0, 6) + quarters(17, 20)),
    ("ds-coda", score(ds_measures()), quarters(0, 15) + quarters(5, 9) + quarters(17, 20)),
    (
        "after-yes",
        score(jump_measures("yes")),
        quarters(0, 8) * 2 + quarters(8, 14) + quarters(0, 8) * 2 + quarters(8, 10),
    ),
    (
        "after-no",
        score(jump_measures("no")),
        quarters(0, 8) * 2 + quarters(8, 14) + quarters(0, 10),
    ),
    (
        "invisible",
        score([measure(0), measure(1, {0: INVISIBLE}), measure(2, {4: backward()})]),
        quarters(0, 12) + quarters(4, 12),
    ),
]


@pytest.mark.parametrize("name,xml,path", WITNESSES, ids=[w[0] for w in WITNESSES])
def test_final_real_midi_has_canonical_pitch_order_partial_spans_and_end(name, xml, path):
    xml = distinctive_pitches(xml)
    plan = build_performance_plan(parse_score_semantics(xml))
    content = VerovioMidiCompiler().compile(xml.encode()).content
    midi = parse_standard_midi(content)
    notes = [
        (position, data[0])
        for _, position, status, data in channel_events(content)
        if status & 240 == 144 and data[1]
    ]
    assert notes == [(Fraction(i), 48 + (q // 4) * 5 + q % 4) for i, q in enumerate(path)]
    assert plan.projection.end == Fraction(len(path))
    assert all(
        track[-1].meta_type == 47 and track[-1].position == plan.projection.end
        for track in midi.tracks
    )
    # Every performed onset is balanced, including jump-cut terminations.
    active = set()
    for track_index, track in enumerate(midi.tracks):
        for e in track:
            key = track_index, e.status & 15, e.data[0] if e.data else 0
            if e.status & 240 == 144 and e.data[1]:
                assert key not in active
                active.add(key)
            elif e.status & 240 == 128 or (e.status & 240 == 144 and not e.data[1]):
                assert key in active
                active.remove(key)
    assert not active


def test_realization_accepts_namespaced_canonical_document():
    xml = score([measure(0)]).replace(
        "<score-partwise ", '<score-partwise xmlns="http://www.musicxml.org/ns/musicxml" '
    )
    result = parse_standard_midi(VerovioMidiCompiler().compile(xml.encode()).content)
    assert result.tracks[-1][-1].position == 4


def test_real_whole_note_is_terminated_at_mid_measure_dc_source_and_fine():
    # Each note is one whole written measure. Navigation commands use exact
    # sound offsets into those notes; no onset is invented on the second entry.
    whole = "<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>"
    attrs = "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
    xml = '<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">'
    for index in range(4):
        nav = ""
        if index in (1, 3):
            nav = (
                "<sound "
                + ('fine="yes"' if index == 1 else 'dacapo="yes"')
                + "><offset>-2</offset></sound>"
            )
        xml += f'<measure number="{index + 1}">{attrs if index == 0 else ""}{whole}{nav}</measure>'
    xml += "</part></score-partwise>"
    toolkit = verovio.toolkit()
    toolkit.setOptions({"inputFrom": "xml", "expandNever": True})
    assert toolkit.loadData(xml)
    written = parse_standard_midi(base64.b64decode(toolkit.renderToMIDI()))
    written_offs = [
        e.position
        for track in written.tracks
        for e in track
        if e.status & 240 == 128 or (e.status & 240 == 144 and e.data[1] == 0)
    ]
    output = parse_standard_midi(VerovioMidiCompiler().compile(xml.encode()).content)
    offs = [
        e.position
        for track in output.tracks
        for e in track
        if e.status & 240 == 128 or (e.status & 240 == 144 and e.data[1] == 0)
    ]
    # Natural articulation/release comes from written realization. Only the
    # navigation cuts impose exact domain termination, at q14 and q20.
    assert offs == written_offs[:3] + [Fraction(14), Fraction(14) + written_offs[0], Fraction(20)]
    assert output.tracks[-1][-1].position == 20
