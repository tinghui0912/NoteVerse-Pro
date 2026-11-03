"""Canonical document admission is independent of downstream projection support."""

import xml.etree.ElementTree as ET

import pytest

from app.core.exceptions import ValidationException
from app.processing.musicxml.admission import admit_musicxml_document
from app.score_semantics.musicxml_score import MusicXMLSemanticError, parse_score_semantics
from app.shared.constants import ErrorCode

ATTRIBUTES = "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
NOTE = '<note id="a"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>'
METRONOME = "<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>60</per-minute></metronome></direction-type></direction>"


def score(body=NOTE, attributes=ATTRIBUTES):
    return (
        '<score-partwise><part id="P1"><measure number="1">'
        + attributes
        + body
        + "</measure></part></score-partwise>"
    ).encode()


@pytest.mark.parametrize(
    "content", [score(), b'<?xml version="1.0"?>\n' + score().replace(b"><", b">\n  <")]
)
def test_valid_partwise_bytes_and_missing_tempo_are_preserved_exactly(content):
    admitted = admit_musicxml_document(content)
    assert admitted == content
    assert parse_score_semantics(admitted).tempos == ()
    assert ET.fromstring(admitted).find(".//sound") is None


def test_explicit_metronome_materialization_is_idempotent_and_semantically_valid():
    content = score(METRONOME + NOTE)
    admitted = admit_musicxml_document(content)
    assert admitted != content
    assert ET.fromstring(admitted).find(".//sound").get("tempo") == "120"
    assert parse_score_semantics(admitted).tempos[0].quarter_bpm == 120
    assert admit_musicxml_document(admitted) == admitted


def test_timewise_is_not_an_admitted_canonical_representation():
    with pytest.raises(ValidationException) as caught:
        admit_musicxml_document(
            b'<score-timewise><measure number="1"><part id="P1"/></measure></score-timewise>'
        )
    assert caught.value.code == ErrorCode.REVISION_CONTENT_INVALID


INVALID_WRITTEN = [
    score("<backup><duration>1</duration></backup>" + NOTE),
    score(attributes=""),
    score(NOTE.replace("<pitch>", "<chord/><pitch>")),
    score(
        attributes=ATTRIBUTES.replace(
            "</attributes>", "<time><beats>3</beats><beat-type>4</beat-type></time></attributes>"
        )
    ),
    score('<direction><offset>-1</offset><sound tempo="90"/></direction>' + NOTE),
    score('<sound tempo="90"/><sound tempo="100"/>' + NOTE),
    score('<direction><offset>5</offset><sound tempo="90"/></direction>' + NOTE),
    score(NOTE.replace("<duration>4</duration>", "<duration>NaN</duration>")),
    score("", attributes=""),
    b'<score-partwise><part id="P1"><measure>'
    + ATTRIBUTES.encode()
    + b'</measure></part><part id="P2"><measure>'
    + ATTRIBUTES.replace("<beats>4</beats>", "<beats>3</beats>").encode()
    + b"</measure></part></score-partwise>",
]


@pytest.mark.parametrize("content", INVALID_WRITTEN)
def test_invalid_written_semantics_are_public_revision_content_errors(content):
    with pytest.raises(ValidationException) as caught:
        admit_musicxml_document(content)
    assert caught.value.code == ErrorCode.REVISION_CONTENT_INVALID
    assert caught.value.status_code == 422
    assert isinstance(caught.value.__cause__, MusicXMLSemanticError)


@pytest.mark.parametrize("content", [b"<score-partwise>", b"\xff", b"<invalid/>"])
def test_malformed_xml_or_root_is_not_admitted(content):
    with pytest.raises(ValidationException) as caught:
        admit_musicxml_document(content)
    assert caught.value.code == ErrorCode.REVISION_CONTENT_INVALID


def test_admission_accepts_timed_polymeter_that_practice_cannot_project():
    from app.modules.practice.score.compiler.musicxml import project_practice_score
    from app.modules.practice.score.piano_key import PracticeScoreInvalidError

    content = score().replace(
        b"</score-partwise>",
        b'<part id="P2"><measure>'
        + ATTRIBUTES.replace("<beats>4</beats>", "<beats>3</beats>").encode()
        + NOTE.replace('id="a"', 'id="b"').encode()
        + b"</measure></part></score-partwise>",
    )
    admitted = admit_musicxml_document(content)
    assert admitted == content
    model = parse_score_semantics(admitted)
    assert len(model.meters) == 2
    with pytest.raises(PracticeScoreInvalidError, match="score-wide meter"):
        project_practice_score(model)


@pytest.mark.parametrize(
    "key",
    [
        "<key><key-step>B</key-step><key-alter>-1</key-alter><key-step>E</key-step><key-alter>-2</key-alter></key>",
        "<key><key-step>F</key-step><key-alter>0.5</key-alter></key>",
        '<key number="1"><fifths>1</fifths></key>',
    ],
)
def test_admission_accepts_key_facts_outside_metadata_dto_support(key):
    from app.processing.musicxml.metadata import project_score_metadata, MetadataExtractionError
    from app.modules.practice.score.compiler.musicxml import project_practice_score

    content = score(attributes=ATTRIBUTES.replace("</attributes>", key + "</attributes>"))
    admitted = admit_musicxml_document(content)
    assert admitted == content
    model = parse_score_semantics(admitted)
    assert len(project_practice_score(model).notes) == 1
    with pytest.raises(MetadataExtractionError, match="unsupported_"):
        project_score_metadata(model)


def test_admission_preserves_staff_meter_and_absent_traditional_mode():
    content = score(
        attributes=ATTRIBUTES.replace("<time>", '<time number="1">').replace(
            "</attributes>", "<key><fifths>1</fifths></key></attributes>"
        )
    )
    model = parse_score_semantics(admit_musicxml_document(content))
    assert model.meters[0].staff_number == 1
    assert model.keys[0].mode is None


@pytest.mark.parametrize(
    "content",
    [
        score(NOTE.replace("<octave>4</octave>", "<alter>0.5</alter><octave>4</octave>")),
        score(
            attributes=ATTRIBUTES.replace(
                "</attributes>", "<transpose><chromatic>2</chromatic></transpose></attributes>"
            )
        ),
        score(
            '<note id="grace"><grace/><pitch><step>D</step><octave>4</octave></pitch></note>' + NOTE
        ),
    ],
)
def test_admission_is_not_practice_support_validation(content):
    from app.modules.practice.score.compiler.musicxml import project_practice_score
    from app.modules.practice.score.piano_key import PracticeScoreInvalidError

    admitted = admit_musicxml_document(content)
    assert admitted == content
    with pytest.raises(PracticeScoreInvalidError):
        project_practice_score(parse_score_semantics(admitted))


@pytest.mark.parametrize("namespace", ["", ' xmlns="urn:musicxml"'])
def test_semantic_validation_observes_exact_final_materialized_bytes(monkeypatch, namespace):
    from app.processing.musicxml import admission

    observed = []
    parser = admission.parse_score_semantics

    def observe(content):
        observed.append(content)
        return parser(content)

    monkeypatch.setattr(admission, "parse_score_semantics", observe)
    raw = score(METRONOME + NOTE).replace(
        b"<score-partwise>", f"<score-partwise{namespace}>".encode()
    )
    admitted = admission.admit_musicxml_document(raw)
    assert observed == [admitted]
    assert observed[0] != raw
    assert admission.admit_musicxml_document(admitted) == admitted
    assert observed == [admitted, admitted]


def test_materialized_tempo_does_not_admit_invalid_written_chronology():
    raw = score(METRONOME + "<backup><duration>1</duration></backup>" + NOTE)
    with pytest.raises(ValidationException) as caught:
        admit_musicxml_document(raw)
    assert caught.value.code == ErrorCode.REVISION_CONTENT_INVALID
    assert isinstance(caught.value.__cause__, MusicXMLSemanticError)
