"""The playback source profile classifies its surface and rejects extensions."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.core.exceptions import ValidationException
from app.modules.playback.performance_plan_service import compile_performance_plan
from app.processing.engines.playback.standard_midi import parse_standard_midi
from app.processing.engines.playback.verovio_midi import VerovioMidiCompiler
from app.processing.musicxml.admission import admit_musicxml_document
from app.processing.musicxml.verovio_written_realization import (
    _Disposition,
    _SURFACES,
    VerovioWrittenRealizationError,
    validate_verovio_written_realization,
)
from app.score_semantics.musicxml_score import parse_score_semantics
from tests.support.written_realization_sources import SOURCES, PROFILE_SOURCES, with_sound


def validate(xml):
    admitted = admit_musicxml_document(xml.encode())
    validate_verovio_written_realization(admitted, parse_score_semantics(admitted))


def test_musicxml_40_playback_surfaces_have_explicit_classifications():
    inventory = json.loads(
        (Path(__file__).parent / "fixtures/musicxml-4.0-playback-surfaces.json").read_text()
    )
    for name, surface in inventory["surfaces"].items():
        actual = _SURFACES[name]
        assert set(surface["attributes"]) <= actual.attributes.keys(), name
        assert set(surface["children"]) <= actual.children.keys(), name
    for name in ("sound", "midi-instrument", "score-instrument"):
        surface = inventory["surfaces"][name]
        assert set(surface["attributes"]) == _SURFACES[name].attributes.keys()
        assert set(surface["children"]) == _SURFACES[name].children.keys()
    assert {r.disposition for p in _SURFACES.values() for r in p.attributes.values()} == set(
        _Disposition
    )


def test_supported_containers_have_closed_child_profiles():
    for name, surface in _SURFACES.items():
        for child, rule in surface.children.items():
            if rule.disposition is _Disposition.SUPPORTED:
                assert child in _SURFACES, (name, child)


@pytest.mark.parametrize("version", ["3.1", "4.0"])
@pytest.mark.parametrize("namespace", ["", "http://www.musicxml.org/ns/musicxml"])
def test_supported_source_editions_and_namespaces_use_the_same_profile(version, namespace):
    xml = SOURCES["piano"].replace('version="4.0"', f'version="{version}"')
    if namespace:
        xml = xml.replace("<score-partwise ", f'<score-partwise xmlns="{namespace}" ')
    validate(xml)


def test_future_source_edition_is_not_implicitly_supported():
    xml = SOURCES["piano"].replace('version="4.0"', 'version="9.0"')
    with pytest.raises(
        VerovioWrittenRealizationError, match="unsupported_verovio_playback_profile"
    ):
        validate(xml)


@pytest.mark.parametrize("name,case", PROFILE_SOURCES.items(), ids=PROFILE_SOURCES)
@pytest.mark.parametrize("namespace", ["", "http://www.musicxml.org/ns/musicxml"])
def test_feature_classification_is_namespace_independent(name, case, namespace):
    xml = case["musicxml"]
    if namespace:
        xml = xml.replace("<score-partwise ", f'<score-partwise xmlns="{namespace}" ')
    if case["reason"]:
        with pytest.raises(VerovioWrittenRealizationError, match=case["reason"]):
            validate(xml)
    else:
        validate(xml)


@pytest.mark.parametrize(
    "field,value",
    [
        ("tempo", "100"),
        ("dacapo", "yes"),
        ("segno", "S1"),
        ("dalsegno", "S1"),
        ("coda", "C1"),
        ("tocoda", "C1"),
        ("forward-repeat", "yes"),
        ("fine", "yes"),
        ("time-only", "2"),
        ("divisions", '3" segno="S1'),
    ],
)
def test_supported_sound_fields_are_source_fidelity_capabilities_not_navigation_execution(
    field, value
):
    assert _SURFACES["sound"].attributes[field].disposition is _Disposition.SUPPORTED
    validate(with_sound(f'<sound {field}="{value}"/>'))


@pytest.mark.parametrize(
    "context,markup",
    [
        ("sound", '<sound future-gain="2"/>'),
        ("sound", "<sound><future-playback/></sound>"),
        ("sound", '<sound xmlns:f="urn:extension" f:tempo="100"/>'),
        ("sound", '<sound xmlns:f="urn:extension"><f:offset>1</f:offset></sound>'),
        (
            "instrument",
            '<midi-instrument id="P1I1" future-gain="2"><midi-program>1</midi-program></midi-instrument>',
        ),
        ("instrument", '<midi-instrument id="P1I1"><future-playback/></midi-instrument>'),
        (
            "identity",
            '<score-instrument id="P1I1"><instrument-name>Piano</instrument-name><future-sound/></score-instrument>',
        ),
        ("note", '<note future-attack="2" id="n0"'),
        ("note-child", "<future-playback/>"),
        ("measure", "<future-playback/>"),
        ("direction", "<direction><direction-type><future-playback/></direction-type></direction>"),
    ],
)
@pytest.mark.parametrize("namespace", ["", "urn:musicxml"])
def test_unclassified_playback_surface_fails_closed(context, markup, namespace):
    xml = SOURCES["piano"]
    if context in {"sound", "measure", "direction"}:
        xml = with_sound(markup)
    elif context in {"instrument", "identity"}:
        tag = "midi-instrument" if context == "instrument" else "score-instrument"
        start = xml.index(f"<{tag} ")
        end = xml.index(f"</{tag}>", start) + len(f"</{tag}>")
        xml = xml[:start] + markup + xml[end:]
    elif context == "note":
        xml = xml.replace('<note id="n0"', markup)
    else:
        xml = xml.replace("</pitch>", "</pitch>" + markup, 1)
    if namespace:
        xml = xml.replace("<score-partwise ", f'<score-partwise xmlns="{namespace}" ')
    with pytest.raises(
        VerovioWrittenRealizationError, match="unsupported_verovio_playback_profile"
    ):
        validate(xml)


@pytest.mark.parametrize(
    "attribute", ["end-dynamics", "attack", "release", "time-only", "pizzicato"]
)
def test_note_playback_state_outside_the_profile_is_explicitly_unsupported(attribute):
    value = "yes" if attribute == "pizzicato" else "1"
    xml = SOURCES["piano"].replace('<note id="n0"', f'<note {attribute}="{value}" id="n0"')
    with pytest.raises(
        VerovioWrittenRealizationError, match="unsupported_verovio_playback_profile"
    ):
        validate(xml)


@pytest.mark.parametrize(
    "notation",
    [
        "<articulations><staccato/></articulations>",
        "<ornaments><trill-mark/></ornaments>",
        '<ornaments><tremolo type="single">3</tremolo></ornaments>',
        "<arpeggiate/>",
        '<non-arpeggiate type="top"/>',
        "<fermata/>",
    ],
)
def test_expressive_sound_families_are_not_delegated_to_renderer_policy(notation):
    xml = SOURCES["piano"].replace("</note>", f"<notations>{notation}</notations></note>", 1)
    with pytest.raises(
        VerovioWrittenRealizationError, match="unsupported_verovio_playback_profile"
    ):
        validate(xml)


def test_presentation_metadata_and_fingering_do_not_request_sound():
    xml = SOURCES["piano"].replace(
        "</type>", "</type><notations><technical><fingering>1</fingering></technical></notations>"
    )
    xml = xml.replace(
        "</score-instrument>",
        '</score-instrument><score-instrument id="unused"><instrument-name>Other</instrument-name><virtual-instrument><virtual-library>Unreferenced</virtual-library><virtual-name>Unused</virtual-name></virtual-instrument></score-instrument>',
    )
    validate(xml)
    assert compile_performance_plan(xml).performance_end.numerator == 4


def test_unreferenced_instrument_extensions_are_still_classified():
    xml = SOURCES["piano"].replace(
        "</score-instrument>",
        '</score-instrument><score-instrument id="unused"><future-sound/></score-instrument>',
    )
    with pytest.raises(
        VerovioWrittenRealizationError, match="unsupported_verovio_playback_profile"
    ):
        validate(xml)


def test_unreferenced_virtual_metadata_has_no_unclassified_nested_extension():
    xml = SOURCES["piano"].replace(
        "</score-instrument>",
        '</score-instrument><score-instrument id="unused"><virtual-instrument><future-sound/></virtual-instrument></score-instrument>',
    )
    with pytest.raises(
        VerovioWrittenRealizationError, match="unsupported_verovio_playback_profile"
    ):
        validate(xml)


def test_default_instrument_requires_agreement_between_declaration_orders():
    xml = SOURCES["multipleInstruments"]
    start = xml.index('<midi-instrument id="P1I1"')
    middle = xml.index('<midi-instrument id="P1I2"')
    end = xml.index("</midi-instrument>", middle) + len("</midi-instrument>")
    xml = xml[:start] + xml[middle:end] + xml[start:middle] + xml[end:]
    # No sound update or note switch masks the origin-assignment check.
    begin = xml.index("<direction>")
    finish = xml.index("</direction>", begin) + len("</direction>")
    xml = (xml[:begin] + xml[finish:]).replace('<instrument id="P1I2"/>', '<instrument id="P1I1"/>')
    with pytest.raises(
        VerovioWrittenRealizationError, match="unsupported_verovio_instrument_assignment"
    ):
        validate(xml)


@pytest.mark.parametrize(
    "markup",
    [
        '<direction><direction-type><words future-gain="2">Text</words></direction-type></direction>',
        "<direction><direction-type><words><future-playback/></words></direction-type></direction>",
        '<direction><direction-type><words><sound tempo="100"/></words></direction-type></direction>',
    ],
)
def test_presentation_vocabulary_does_not_accept_playback_extensions(markup):
    with pytest.raises(
        VerovioWrittenRealizationError, match="unsupported_verovio_playback_profile"
    ):
        validate(with_sound(markup))


def test_notated_ties_do_not_supply_an_unowned_audible_tie():
    visual = SOURCES["piano"].replace(
        "</type>", '</type><notations><tied type="start"/></notations>', 1
    )
    with pytest.raises(
        VerovioWrittenRealizationError, match="unsupported_verovio_playback_profile"
    ):
        validate(visual)
    matching = visual.replace("</duration>", '</duration><tie type="start"/>', 1)
    marker = matching.index('<note id="n1"')
    matching = matching[:marker] + matching[marker:].replace(
        "</duration>", '</duration><tie type="stop"/>', 1
    ).replace("</type>", '</type><notations><tied type="stop"/></notations>', 1)
    validate(matching)


@pytest.mark.parametrize("name,case", PROFILE_SOURCES.items(), ids=PROFILE_SOURCES)
def test_profile_cases_have_the_same_application_and_backend_boundary(name, case):
    xml, reason = case["musicxml"], case["reason"]
    admitted = admit_musicxml_document(xml.encode())
    model = parse_score_semantics(admitted)
    if reason:
        with pytest.raises(ValidationException) as exc:
            compile_performance_plan(xml)
        assert exc.value.details == {"reason": reason}
        with patch("verovio.toolkit") as toolkit:
            with pytest.raises(RuntimeError, match=reason):
                VerovioMidiCompiler().compile(admitted)
            toolkit.assert_not_called()
    else:
        assert compile_performance_plan(xml).performance_end.numerator == model.end
        final = parse_standard_midi(VerovioMidiCompiler().compile(admitted).content)
        assert [
            e.data[0] for t in final.tracks for e in t if e.status & 240 == 144 and e.data[1]
        ] == [
            event[3][0]
            for event in case["expected"]["channelEvents"]
            if event[2] & 240 == 144 and event[3][1]
        ]
        assert all(t[-1].position == model.end for t in final.tracks)


@pytest.mark.parametrize(
    "change",
    [
        ("<chromatic>-2</chromatic>", "<chromatic>-1.5</chromatic>"),
        ("<transpose>", '<transpose number="1">'),
        ("</transpose>", "<double/></transpose>"),
    ],
)
def test_transposition_forms_outside_static_integer_part_profile_fail(change):
    xml = PROFILE_SOURCES["chromaticTranspose"]["musicxml"].replace(*change)
    with pytest.raises(VerovioWrittenRealizationError, match="unsupported_verovio_transposition"):
        validate(xml)
