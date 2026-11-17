"""Playback source fidelity is shared; canonical admission remains broader."""

from tests.support.performance_plan import performed_duration_ms

from unittest.mock import patch

import pytest

from app.core.exceptions import ValidationException
from app.modules.playback.performance_plan_service import compile_performance_plan
from app.processing.engines.playback.verovio_midi import VerovioMidiCompiler
from app.processing.engines.playback.standard_midi import parse_standard_midi
from app.processing.musicxml.admission import admit_musicxml_document
from app.score_semantics.musicxml_score import parse_score_semantics
from tests.support.written_realization_sources import (
    SOURCES,
    LOSSY_SOURCES,
    LOSSY_SOUND_CONTROLS,
    LOSSY_INSTRUMENT_CONTROLS,
    SWING_SOURCE,
    with_sound,
    with_origin_instrument_state,
)
from app.processing.musicxml.verovio_written_realization import (
    VerovioWrittenRealizationError,
    validate_verovio_written_realization,
)


@pytest.mark.parametrize("xml,reason", LOSSY_SOURCES, ids=[r for _, r in LOSSY_SOURCES])
def test_plan_rejects_lossy_source_with_a_playback_reason(xml, reason):
    admitted = admit_musicxml_document(xml.encode())
    assert parse_score_semantics(admitted).end == 4
    with pytest.raises(ValidationException) as exc:
        compile_performance_plan(xml)
    assert exc.value.code == "score_playback_failed"
    assert exc.value.details == {"reason": reason}


@pytest.mark.parametrize("xml,reason", LOSSY_SOURCES, ids=[r for _, r in LOSSY_SOURCES])
def test_midi_compiler_rejects_source_before_renderer_is_constructed(xml, reason):
    with patch("verovio.toolkit") as toolkit:
        with pytest.raises(RuntimeError, match=f"score_playback_failed: {reason}"):
            VerovioMidiCompiler().compile(xml.encode())
        toolkit.assert_not_called()


@pytest.mark.parametrize("name", ["piano", "duet", "dynamics", "pedal"])
def test_faithful_sources_reach_both_playback_consumers(name):
    xml = SOURCES[name]
    assert compile_performance_plan(xml).performance_end.numerator == 4
    final = parse_standard_midi(VerovioMidiCompiler().compile(xml.encode()).content)
    notes = [e for t in final.tracks for e in t if e.status & 240 == 144 and e.data[1]]
    assert [e.data[1] for e in notes] == ([27, 81] if name == "dynamics" else [90] * len(notes))
    assert len(notes) == (4 if name == "duet" else 2)
    assert all(t[-1].position == 4 for t in final.tracks)
    if name == "duet":
        assert [e.data[0] for t in final.tracks for e in t if e.status & 240 == 192] == [0, 40]
    if name == "pedal":
        assert [tuple(e.data) for t in final.tracks for e in t if e.status & 240 == 176] == [
            (64, 127),
            (64, 0),
        ]


@pytest.mark.parametrize("name", ["microtonal", "directionDynamics", "multipleInstruments"])
def test_metadata_does_not_require_sound_realization(name):
    assert performed_duration_ms(SOURCES[name]) == 3000


@pytest.mark.parametrize("xml", [with_sound(s) for s in LOSSY_SOUND_CONTROLS] + [SWING_SOURCE])
def test_sound_owned_audible_controls_are_not_silently_discarded(xml):
    with pytest.raises(ValidationException) as exc:
        compile_performance_plan(xml)
    assert exc.value.details == {"reason": "unsupported_verovio_sound_state"}


@pytest.mark.parametrize("markup", LOSSY_INSTRUMENT_CONTROLS)
def test_unsupported_origin_instrument_controls_fail_playback(markup):
    with pytest.raises(ValidationException) as exc:
        compile_performance_plan(with_origin_instrument_state(markup))
    assert exc.value.details == {"reason": "unsupported_verovio_instrument_state"}


def test_visual_dynamics_and_unused_instrument_definitions_are_not_playback_changes():
    xml = SOURCES["multipleInstruments"]
    start = xml.index("<direction>")
    end = xml.index("</direction>", start) + len("</direction>")
    xml = xml[:start] + xml[end:]
    xml = xml.replace('id="P1I2"/><type>', 'id="P1I1"/><type>')
    xml = xml.replace(
        '<note id="n0"',
        '<direction><direction-type><dynamics><f/></dynamics></direction-type></direction><note id="n0"',
    )
    assert compile_performance_plan(xml).performance_end.numerator == 4
    VerovioMidiCompiler().compile(xml.encode())


def test_note_assignments_cannot_switch_instruments_without_sound():
    xml = SOURCES["multipleInstruments"]
    start = xml.index("<direction>")
    end = xml.index("</direction>", start) + len("</direction>")
    with pytest.raises(ValidationException, match="score_playback_failed"):
        compile_performance_plan(xml[:start] + xml[end:])


def test_static_violin_is_not_limited_by_browser_assets():
    xml = SOURCES["piano"].replace("<midi-program>1<", "<midi-program>41<")
    assert compile_performance_plan(xml).performance_end.numerator == 4
    final = parse_standard_midi(VerovioMidiCompiler().compile(xml.encode()).content)
    assert [e.data for t in final.tracks for e in t if e.status & 240 == 192] == [b"\x28"]


@pytest.mark.parametrize("xml,reason", LOSSY_SOURCES, ids=[r for _, r in LOSSY_SOURCES])
def test_namespaced_source_uses_the_same_typed_capability_error(xml, reason):
    xml = xml.replace(
        "<score-partwise ", '<score-partwise xmlns="http://www.musicxml.org/ns/musicxml" '
    )
    admitted = admit_musicxml_document(xml.encode())
    with pytest.raises(VerovioWrittenRealizationError) as exc:
        validate_verovio_written_realization(admitted, parse_score_semantics(admitted))
    assert exc.value.reason.value == reason
