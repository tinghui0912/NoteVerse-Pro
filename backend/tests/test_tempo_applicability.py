"""Source applicability, admission equivalence and consumer capability limits."""

from copy import deepcopy
from fractions import Fraction
import xml.etree.ElementTree as ET

import pytest
import verovio

from app.core.exceptions import ValidationException
from app.modules.practice.score.compiler.musicxml import (
    compile_practice_score,
    project_practice_score,
)
from app.modules.practice.score.piano_key import PracticeScoreInvalidError
from app.processing.musicxml.admission import admit_musicxml_document
from app.processing.musicxml.metadata import MetadataExtractionError, extract_musicxml_metadata
from app.processing.engines.playback.tempo_projection import (
    playback_musicxml,
)
from app.processing.engines.playback.verovio_midi import VerovioMidiCompiler
from tests.test_playback_tempo_policy import conductor_events
from app.score_semantics.musicxml_score import MusicXMLSemanticError, parse_score_semantics
from app.score_semantics.musicxml_tempo import parse_tempo_directive, MusicXMLTempoError
from app.score_semantics.performance_navigation import (
    PerformanceNavigationError,
    project_performance_occurrences,
)
from app.score_semantics.written_point import WrittenPoint

ATTR = "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
NOTE = '<note id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>'
METRO = "<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type>"


def score(body, other=None):
    extra = (
        f'<part id="P2"><measure number="1">{ATTR}{other}{NOTE.replace("n1", "n2")}</measure></part>'
        if other is not None
        else ""
    )
    return f'<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1">{ATTR}{body}{NOTE}</measure></part>{extra}</score-partwise>'.encode()


def gated(bpm, passes):
    return f'<sound tempo="{bpm}"' + (f' time-only="{passes}"' if passes is not None else "") + "/>"


def test_practice_rejects_sound_only_gated_tempo_after_successful_canonical_admission():
    content = score(gated(100, "2"))
    trusted = admit_musicxml_document(content)
    model = parse_score_semantics(trusted)
    assert model.tempos[0].time_only == (2,)
    for compile_call in (
        lambda: compile_practice_score(trusted),
        lambda: project_practice_score(model),
    ):
        with pytest.raises(
            PracticeScoreInvalidError, match="Practice does not support pass-gated tempo"
        ):
            compile_call()
    with pytest.raises(MetadataExtractionError, match="unsupported_time_only_playback"):
        extract_musicxml_metadata(trusted)


def test_direction_without_metronome_keeps_its_gated_sound_tempo_byte_identical():
    content = score(f"<direction>{gated(100, '2')}</direction>")
    assert admit_musicxml_document(content) == content
    assert parse_score_semantics(content).tempos[0].time_only == (2,)


@pytest.mark.parametrize(
    "sound,marking,expected",
    [
        (gated(100, "2"), "", (2,)),
        ("", METRO, None),
        ('<sound dynamics="70" time-only="2"/>', METRO, None),
        (gated(100, "2"), METRO, None),
    ],
)
def test_tempo_directive_applicability_belongs_to_its_source(sound, marking, expected):
    element = ET.fromstring(f"<direction>{marking}{sound}</direction>")
    directive = parse_tempo_directive(element, Fraction(1))
    assert (directive.quarter_bpm, directive.time_only) == (100, expected)


@pytest.mark.parametrize("namespace", ["", "urn:musicxml"])
@pytest.mark.parametrize(
    "sound,offset",
    [
        ("", ""),
        ('<sound dynamics="70"/>', ""),
        ('<sound dynamics="70" time-only="2"/>', ""),
        ('<sound dynamics="70" dalsegno="S1" time-only="2"/>', ""),
        (
            '<sound dynamics="70" time-only="2"><play><mute>on</mute></play><offset>2</offset></sound>',
            "",
        ),
        ('<sound dalsegno="S1" time-only="2"/>', '<offset sound="yes">2</offset>'),
        (
            '<sound dalsegno="S1" time-only="2"><offset>2</offset></sound>',
            '<offset sound="yes">1</offset>',
        ),
        (gated(100, "2"), ""),
    ],
)
def test_materialization_preserves_raw_tempo_and_other_sound_semantics(sound, offset, namespace):
    content = score(f"<direction>{METRO}{offset}{sound}</direction>")
    if namespace:
        content = content.replace(
            b"<score-partwise ", f'<score-partwise xmlns="{namespace}" '.encode()
        )
    raw = parse_score_semantics(content)
    trusted = admit_musicxml_document(content)
    model = parse_score_semantics(trusted)
    assert model.tempos == raw.tempos
    assert model.playback_navigation == raw.playback_navigation
    assert model.tempos[0].time_only is None
    assert admit_musicxml_document(trusted) == trusted
    root = ET.fromstring(trusted)
    sounds = [e for e in root.iter() if e.tag.rsplit("}", 1)[-1] == "sound"]
    assert len([s for s in sounds if "tempo" in s.attrib]) == 1
    tempo = next(s for s in sounds if "tempo" in s.attrib)
    assert tempo.get("time-only") is None
    if "time-only" in sound:
        original = next(s for s in sounds if s.get("time-only") == "2")
        before = ET.fromstring(f"<sound-wrapper>{sound}</sound-wrapper>")[0]
        for key, value in before.attrib.items():
            if key != "tempo":
                assert original.get(key) == value
        for child in before:
            match = next(c for c in original if c.tag.rsplit("}", 1)[-1] == child.tag)
            plain = deepcopy(match)
            for descendant in plain.iter():
                descendant.tag = descendant.tag.rsplit("}", 1)[-1]
            assert ET.tostring(plain) == ET.tostring(child)
        if namespace:
            assert all(e.tag.startswith("{" + namespace + "}") for s in sounds for e in s.iter())
    if not raw.playback_navigation:
        assert compile_practice_score(trusted).tempo_segments[0].bpm == 100


@pytest.mark.parametrize("cross_part", [False, True])
def test_disjoint_gated_tempos_are_admitted_without_flattening(cross_part):
    first, second = gated(80, "1"), gated(100, "2")
    repeat_start = '<barline location="left"><repeat direction="forward"/></barline>'
    repeat_end = '<barline><repeat direction="backward"/></barline>'
    content = score(
        repeat_start + first + ("" if cross_part else second) + repeat_end,
        second if cross_part else None,
    )
    model = parse_score_semantics(admit_musicxml_document(content))
    assert [(t.point, t.quarter_bpm, t.time_only) for t in model.tempos] == [
        (WrittenPoint(0, Fraction(0)), 80, (1,)),
        (WrittenPoint(0, Fraction(0)), 100, (2,)),
    ]
    with pytest.raises(PerformanceNavigationError, match="unsupported_time_only_playback"):
        project_performance_occurrences(model)
    with pytest.raises(PracticeScoreInvalidError, match="pass-gated tempo"):
        project_practice_score(model)


@pytest.mark.parametrize("cross_part", [False, True])
@pytest.mark.parametrize("left,right", [("1,2", "2,3"), (None, "2"), ("2", None), ("1", "1")])
def test_different_bpms_conflict_only_when_applicability_overlaps(cross_part, left, right):
    content = score(
        gated(80, left) + ("" if cross_part else gated(100, right)),
        gated(100, right) if cross_part else None,
    )
    with pytest.raises(MusicXMLSemanticError, match="invalid_tempo"):
        parse_score_semantics(content)
    with pytest.raises(ValidationException):
        admit_musicxml_document(content)


@pytest.mark.parametrize("left,right", [("1,2", "2,3"), ("1", "1"), (None, "2")])
def test_equal_bpm_facts_with_overlapping_applicability_are_retained(left, right):
    model = parse_score_semantics(
        admit_musicxml_document(score(gated(100, left) + gated(100, right)))
    )
    assert len(model.tempos) == 2
    assert [t.quarter_bpm for t in model.tempos] == [100, 100]


def test_resolved_offset_slots_compare_applicability_across_parts():
    # Both facts resolve to written quarter 1, reached from opposite cursor offsets.
    left = '<forward><duration>2</duration></forward><sound tempo="80" time-only="1,3"><offset>-1</offset></sound>'
    right = '<sound tempo="100" time-only="2"><offset>1</offset></sound>'
    model = parse_score_semantics(admit_musicxml_document(score(left, right)))
    assert [t.point for t in model.tempos] == [WrittenPoint(0, Fraction(1))] * 2
    assert [t.time_only for t in model.tempos] == [(1, 3), (2,)]
    with pytest.raises(MusicXMLSemanticError, match="invalid_tempo"):
        parse_score_semantics(score(left, right.replace('time-only="2"', 'time-only="3"')))


def test_gated_endpoint_and_next_start_are_distinct_semantic_slots():
    content = score("").replace(
        b"</measure></part>",
        (
            gated(80, "1")
            + '</measure><measure number="2">'
            + gated(100, "1")
            + NOTE.replace("n1", "n2")
            + "</measure></part>"
        ).encode(),
    )
    model = parse_score_semantics(admit_musicxml_document(content))
    assert [(t.point, t.quarter_bpm) for t in model.tempos] == [
        (WrittenPoint(0, Fraction(4)), 80),
        (WrittenPoint(1, Fraction(4)), 100),
    ]


def test_mismatching_metronome_and_sound_still_conflict():
    with pytest.raises(MusicXMLTempoError, match="conflict"):
        parse_tempo_directive(
            ET.fromstring(f"<direction>{METRO}{gated(120, '2')}</direction>"), Fraction(1)
        )


@pytest.mark.parametrize("namespace", ["", "urn:musicxml"])
@pytest.mark.parametrize("own_offset", [False, True])
@pytest.mark.parametrize(
    "children",
    [
        "<play><mute>on</mute></play>",
        "<swing><first>2</first><second>1</second><swing-type>eighth</swing-type></swing>",
        "<play><mute>on</mute></play><swing><first>2</first><second>1</second><swing-type>eighth</swing-type></swing>",
    ],
)
def test_valid_sound_children_keep_order_before_owned_or_inherited_offset(
    namespace, own_offset, children
):
    sound = (
        f'<sound dynamics="70" dalsegno="S1" time-only="2">{children}'
        + ("<offset>2</offset>" if own_offset else "")
        + "</sound>"
    )
    content = score(f'<direction>{METRO}<offset sound="yes">2</offset>{sound}</direction>')
    if namespace:
        content = content.replace(
            b"<score-partwise ", f'<score-partwise xmlns="{namespace}" '.encode()
        )
    before = parse_score_semantics(content)
    trusted = admit_musicxml_document(content)
    root = ET.fromstring(trusted)
    measure = next(e for e in root.iter() if e.tag.rsplit("}", 1)[-1] == "measure")
    original = next(e for e in measure if e.tag.rsplit("}", 1)[-1] == "sound")
    expected = list(ET.fromstring(f"<sound>{children}<offset>2</offset></sound>"))
    assert [e.tag.rsplit("}", 1)[-1] for e in original] == [e.tag for e in expected]
    plain = deepcopy(original)
    for element in plain.iter():
        element.tag = element.tag.rsplit("}", 1)[-1]
    assert [ET.tostring(e) for e in plain] == [ET.tostring(e) for e in expected]
    assert original.attrib == {"dynamics": "70", "dalsegno": "S1", "time-only": "2"}
    after = parse_score_semantics(trusted)
    assert after.tempos == before.tempos
    assert after.playback_navigation == before.playback_navigation
    assert (after.tempos[0].position, after.tempos[0].time_only) == (2, None)
    assert (after.playback_navigation[0].position, after.playback_navigation[0].time_only) == (
        2,
        (2,),
    )
    assert admit_musicxml_document(trusted) == trusted
    if namespace:
        assert all(e.tag.startswith("{" + namespace + "}") for e in root.iter())


def test_real_verovio_receives_ungated_materialized_tempo_at_the_canonical_point():
    content = score(
        f'<direction>{METRO}<offset sound="yes">2</offset><sound dynamics="70" time-only="2"><play><mute>on</mute></play></sound></direction>'
    )
    trusted = admit_musicxml_document(content)
    model = parse_score_semantics(trusted)
    assert (model.tempos[0].position, model.tempos[0].time_only) == (2, None)
    toolkit = verovio.toolkit()
    toolkit.setOptions({"inputFrom": "xml"})
    assert toolkit.loadData(playback_musicxml(trusted))
    toolkit.renderToMIDI()
    tempos = conductor_events(VerovioMidiCompiler().compile(trusted).content)
    assert tempos == [(Fraction(0), Fraction(80)), (Fraction(2), Fraction(100))]
