"""Observable SMF tempo chronology, using the installed Verovio engine."""

from fractions import Fraction
from pathlib import Path
import shutil
import base64
import xml.etree.ElementTree as ET

import pytest
from tests.support.midi_observations import conductor_events
import verovio

from app.processing.engines.playback.verovio_midi import VerovioMidiCompiler
from dataclasses import replace
from app.processing.engines.playback.standard_midi import (
    parse_standard_midi,
    serialize_standard_midi,
)
from app.processing.engines.playback.performance_midi import project_performance_midi
from app.processing.musicxml.admission import admit_musicxml_document
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_plan import build_performance_plan


def note(duration=2):
    kind = {1: "quarter", 2: "half", 4: "whole"}[duration]
    return f"<note><pitch><step>C</step><octave>4</octave></pitch><duration>{duration}</duration><type>{kind}</type></note>"


def direction(bpm):
    return f'<direction><sound tempo="{bpm}"/></direction>'


def score(body):
    return (
        '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
        + body
        + "</measure></part></score-partwise>"
    ).encode()


@pytest.mark.parametrize(
    "body, expected",
    [
        (note() + note(), [(0, 80)]),
        (direction(90) + note() + note(), [(0, 90)]),
        (direction(100) + note() + note(), [(0, 100)]),
        (note() + direction(90) + note(), [(0, 80), (2, 90)]),
        (note(1) + direction(90) + note(1) + direction(100) + note(), [(0, 80), (1, 90), (2, 100)]),
        (
            "<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>60</per-minute></metronome></direction-type></direction>"
            + note()
            + note(),
            [(0, 120)],
        ),
        (
            "<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type></direction>"
            + note()
            + note(),
            [(0, 90)],
        ),
        (note() + '<sound tempo="90"/>' + note(), [(0, 80), (2, 90)]),
    ],
)
def test_compiler_uses_effective_product_tempo_and_preserves_explicit_changes(body, expected):
    content = score(body)
    before = bytes(content)
    midi = VerovioMidiCompiler().compile(content).content
    events = conductor_events(midi)
    assert [event[0] for event in events] == [event[0] for event in expected]
    assert [event[1] for event in events] == pytest.approx(
        [event[1] for event in expected], rel=1e-6
    )
    assert content == before


def test_engine_implicit_tempo_cannot_become_product_authority():
    toolkit = verovio.toolkit()
    toolkit.setOptions({"inputFrom": "xml", "expandNever": True})
    assert toolkit.loadData(score(note() + note()).decode())
    engine_midi = base64.b64decode(toolkit.renderToMIDI())
    written = parse_standard_midi(engine_midi)
    foreign = replace(
        written,
        tracks=tuple(
            tuple(
                replace(e, tempo_bpm=Fraction(173)) if e.tempo_bpm is not None else e for e in track
            )
            for track in written.tracks
        ),
    )
    plan = build_performance_plan(parse_score_semantics(score(note() + note())))
    projected = serialize_standard_midi(project_performance_midi(foreign, plan))
    assert conductor_events(projected) == [(0, 80)]


def test_missing_tempo_is_only_a_consumer_projection_not_a_source_fact():
    content = score(note() + note())
    assert admit_musicxml_document(content) == content
    VerovioMidiCompiler().compile(content)
    assert not any("tempo" in element.attrib for element in ET.fromstring(content).iter())


def test_canonical_explicit_tempos_keep_their_repeat_positions():
    content = (
        score(direction(90) + note(4))
        .decode()
        .replace(
            "</measure>",
            '<barline location="left"><repeat direction="forward"/></barline></measure>',
        )
        .replace(
            "</part>",
            '<measure number="2">'
            + direction(100)
            + note(4)
            + '<barline location="right"><repeat direction="backward"/></barline></measure></part>',
        )
    )
    events = conductor_events(VerovioMidiCompiler().compile(content.encode()).content)
    assert [e[0] for e in events] == [0, 4, 8, 12]
    assert [e[1] for e in events] == pytest.approx([90, 100, 90, 100], rel=1e-6)


def test_canonical_tempo_position_owns_cursor_offset_and_meter_conversion():
    body = (
        note()
        + '<direction><offset sound="yes">-1</offset><sound tempo="90"/></direction>'
        + note()
    )
    content = (
        score(body)
        .decode()
        .replace(
            "<beats>4</beats><beat-type>4</beat-type>", "<beats>8</beats><beat-type>8</beat-type>"
        )
    )
    events = conductor_events(VerovioMidiCompiler().compile(content.encode()).content)
    assert [e[0] for e in events] == [0, 1]
    assert [e[1] for e in events] == pytest.approx([80, 90], rel=1e-6)


def test_backend_audio_timing_follows_product_policy(tmp_path, monkeypatch):
    from app.processing.engines.playback import FluidSynthAudioRenderer, FluidSynthAudioSynthesizer

    # The backend quality image supplies the same binary and GM soundfont as playback.
    assert shutil.which("fluidsynth")
    soundfont = Path("/usr/share/sounds/sf2/FluidR3_GM.sf2")
    assert soundfont.is_file()
    monkeypatch.setattr(
        "app.processing.engines.playback.fluidsynth.settings.WORK_ROOT", str(tmp_path)
    )
    renderer = FluidSynthAudioRenderer(
        audio_synthesizer=FluidSynthAudioSynthesizer(soundfont_path=str(soundfont))
    )
    default = renderer.render(score(note() + note()))
    explicit = renderer.render(score(direction(120) + note() + note()))
    # Identical notes/releases; only the four-quarter musical interval differs.
    assert default.duration_ms - explicit.duration_ms == pytest.approx(1000, abs=20)


@pytest.mark.parametrize(
    "notation, position",
    [
        ('<direction><offset>2</offset><sound tempo="90"/></direction>', 0),
        ('<direction><offset sound="no">2</offset><sound tempo="90"/></direction>', 0),
        ('<direction><offset sound="yes">2</offset><sound tempo="90"/></direction>', 2),
        ('<sound tempo="90"><offset>2</offset></sound>', 2),
        (
            '<direction><offset sound="yes">1</offset><sound tempo="90"><offset>2</offset></sound></direction>',
            2,
        ),
    ],
)
def test_real_renderer_effective_sound_offset(notation, position):
    content = score(notation + note(1) + note(1) + note(1) + note(1))
    events = conductor_events(VerovioMidiCompiler().compile(content).content)
    expected = [(0, 80), (position, 90)] if position else [(0, 90)]
    assert [e[0] for e in events] == [e[0] for e in expected]
    assert [e[1] for e in events] == pytest.approx([e[1] for e in expected], rel=1e-6)


def test_same_tick_conductor_uses_last_encounter_without_changing_plan_history():
    from tests.support.canonical_musicxml import boundary_tempos

    content = boundary_tempos().encode()
    plan = build_performance_plan(parse_score_semantics(content))
    assert [t.bpm for t in plan.tempo_events if t.performance_position == 8] == [100, 80]
    events = conductor_events(VerovioMidiCompiler().compile(content).content)
    assert [position for position, _ in events] == [0, 8, 16]
    assert [bpm for _, bpm in events] == pytest.approx([80, 80, 100], rel=1e-6)
