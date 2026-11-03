"""Observable SMF tempo chronology, using the installed Verovio engine."""

from fractions import Fraction
from pathlib import Path
import shutil
import base64
import xml.etree.ElementTree as ET

import pytest
import verovio

from app.processing.engines.playback.verovio_midi import VerovioMidiCompiler
from app.processing.engines.playback.tempo_projection import (
    project_midi_tempos,
    renderer_tempo_events,
)
from app.processing.musicxml.validation import prepare_musicxml_document
from app.score_semantics.tempo_policy import DEFAULT_SCORE_TEMPO_BPM


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


def conductor_events(midi):
    ppq = int.from_bytes(midi[12:14], "big")
    data = midi[22 : 22 + int.from_bytes(midi[18:22], "big")]
    position = tick = 0
    events = []

    def vlq():
        nonlocal position
        result = 0
        while True:
            value = data[position]
            position += 1
            result = (result << 7) | (value & 127)
            if value < 128:
                return result

    while position < len(data):
        tick += vlq()
        assert data[position] == 255
        kind = data[position + 1]
        position += 2
        length = vlq()
        if kind == 81:
            events.append(
                (
                    Fraction(tick, ppq),
                    60_000_000 / int.from_bytes(data[position : position + length], "big"),
                )
            )
        position += length
    return events


@pytest.mark.parametrize(
    "body, expected",
    [
        (note() + note(), [(0, 80)]),
        (direction(90) + note() + note(), [(0, 90)]),
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
    toolkit.setOptions({"inputFrom": "xml"})
    assert toolkit.loadData(score(note() + note()).decode())
    engine_midi = base64.b64decode(toolkit.renderToMIDI())
    other_engine_default = 173
    foreign = project_midi_tempos(engine_midi, [(Fraction(0), Fraction(other_engine_default))])
    assert conductor_events(foreign)[0][1] == pytest.approx(other_engine_default, rel=1e-6)
    tempos = renderer_tempo_events(
        toolkit.getMEI(),
        toolkit.renderToTimemap({"includeMeasures": True}),
        DEFAULT_SCORE_TEMPO_BPM,
        toolkit.renderToExpansionMap(),
    )
    projected = project_midi_tempos(foreign, tempos)
    assert conductor_events(projected) == [(0, 80)]
    original_end = 22 + int.from_bytes(foreign[18:22], "big")
    projected_end = 22 + int.from_bytes(projected[18:22], "big")
    assert projected[projected_end:] == foreign[original_end:]


def test_missing_tempo_is_only_a_consumer_projection_not_a_source_fact():
    content = score(note() + note())
    assert prepare_musicxml_document(content) == content
    VerovioMidiCompiler().compile(content)
    assert not any("tempo" in element.attrib for element in ET.fromstring(content).iter())


def test_renderer_unfolded_explicit_tempos_keep_their_repeat_positions():
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


def test_renderer_owns_measure_cursor_offset_and_meter_conversion():
    body = note() + '<direction><offset>-1</offset><sound tempo="90"/></direction>' + note()
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
