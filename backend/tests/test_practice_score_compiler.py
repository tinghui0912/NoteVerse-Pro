"""Cross-projection witnesses for the canonical quarter-note beat axis."""

from unittest.mock import Mock
import xml.etree.ElementTree as ET

from tests.practice_bundle_fixtures import bundle_service_for_notation, authorize_test_revision
import pytest

from app.core.exceptions import ValidationException
from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.modules.practice.score.compiler.stable_ids import prepare_musicxml_ids_for_practice
from app.modules.practice.score.piano_key import PracticeScoreInvalidError
from app.modules.practice.score.timeline import practice_timeline_from_compiled
from app.modules.practice.bundle.compiler import PracticeBundleCompiler
from app.modules.practice.score.generated.artifact_transport import PracticeScoreArtifactRead


def meter(n=4, d=4):
    return f"<time><beats>{n}</beats><beat-type>{d}</beat-type></time>"


def attributes(divisions="1", time=None):
    return f"<attributes><divisions>{divisions}</divisions>{meter() if time is None else time}</attributes>"


def note(identity="a", duration="4", step="C", voice="1", chord=False):
    return f'''<note id="{identity}">{"<chord/>" if chord else ""}
      <pitch><step>{step}</step><octave>4</octave></pitch><duration>{duration}</duration>
      <voice>{voice}</voice><staff>1</staff></note>'''


def score(*measures):
    return (
        '<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name>'
        '</score-part></part-list><part id="P1">'
        + "".join(f'<measure number="{i}">{body}</measure>' for i, body in enumerate(measures, 1))
        + "</part></score-partwise>"
    ).encode()


NEXT = f'<attributes>{meter(3, 4)}</attributes><direction><sound tempo="100"/></direction>'


@pytest.mark.parametrize(
    "body,expected,first_onsets",
    [
        (note() + note("b", step="E", chord=True) + note("c", step="G", chord=True), 4, [0, 0, 0]),
        (note() + "<backup><duration>4</duration></backup>" + note("b", "2", voice="2"), 4, [0, 0]),
        (note(duration="1") + "<forward><duration>3</duration></forward>", 4, [0]),
        (note(duration="1"), 1, [0]),
        ("", 4, []),
    ],
)
def test_measure_boundary_is_shared_by_notes_meter_tempo_and_artifact(body, expected, first_onsets):
    xml = score(attributes() + body, NEXT + note("next", "3"))
    prepared = prepare_musicxml_ids_for_practice(xml.decode()).encode()
    compiled = compile_practice_score(prepared)
    assert [n.onset_tick for n in compiled.notes[:-1]] == first_onsets
    assert compiled.measures[0].end_tick == expected
    assert compiled.measures[1].start_tick == expected
    assert compiled.measures[0].uses_meter_duration == (body == "")
    assert (
        compiled.notes[-1].onset_tick
        == compiled.meter_segments[-1].start_tick
        == compiled.tempo_segments[0].start_tick
        == expected
    )
    timeline = practice_timeline_from_compiled(compiled)
    next_note = next(n for n in timeline.notes if n.render_note_id == "next")
    assert (
        next(e for e in timeline.events if e.event_id == next_note.event_id).onset_tick == expected
    )
    bundle = PracticeBundleCompiler().compile(canonical_musicxml=xml)
    artifact = PracticeScoreArtifactRead.model_validate(bundle.artifact.value)
    assert (
        artifact.moments[-1].onsetTick
        == artifact.meterSegments[-1].startTick
        == artifact.scoreTempoSegments[0].startTick
        == expected
    )
    render_ids = {e.get("id") for e in ET.fromstring(bundle.prepared_musicxml.data).iter("note")}
    assert {n.renderNoteId for n in artifact.notes} <= render_ids


def test_divisions_changes_and_direction_offsets_share_quarter_note_axis():
    xml = score(
        attributes("2") + note(duration="6"),
        "<attributes><divisions>4</divisions>" + meter(6, 8) + "</attributes>"
        '<direction><offset sound="yes">4</offset><sound tempo="90"/></direction>'
        + note("b", "4")
        + note("c", "8"),
        NEXT + note("d", "12"),
    )
    compiled = compile_practice_score(xml)
    assert [n.onset_tick for n in compiled.notes] == [0, 6, 8, 12]
    assert [n.duration_ticks for n in compiled.notes] == [6, 2, 4, 6]
    assert [m.start_tick for m in compiled.meter_segments] == [0, 6, 12]
    assert [t.start_tick for t in compiled.tempo_segments] == [8, 12]
    assert compiled.notes[2].onset_tick == compiled.tempo_segments[0].start_tick


def test_rational_cursor_is_canonicalized_once_for_all_projections():
    compiled = compile_practice_score(
        score(
            attributes("3") + note(duration="1") + note("b", "1") + note("c", "1"),
            NEXT + note("d", "3"),
        )
    )
    assert [n.onset_tick for n in compiled.notes] == [0, 1, 2, 3]
    assert (
        compiled.measures[1].start_tick
        == compiled.meter_segments[-1].start_tick
        == compiled.tempo_segments[0].start_tick
        == 3
    )


def test_fractional_tie_endpoints_use_the_compiled_beat_axis():
    compiled = compile_practice_score(
        score(
            attributes("3")
            + note("a", "1", step="D")
            + note("b", "1").replace("</note>", '<tie type="start"/></note>')
            + note("c", "1").replace("</note>", '<tie type="stop"/></note>'),
        )
    )
    timeline = practice_timeline_from_compiled(compiled)
    assert compiled.notes[1].onset_tick == 1
    assert compiled.notes[1].duration_ticks == 1
    assert compiled.notes[2].onset_tick == 2
    assert timeline.moments[-1].canonical_end_tick == 3


def test_part_staff_identity_keeps_tie_ownership_local_to_the_part():
    one = attributes() + note().replace("</note>", '<tie type="start"/></note>')
    two = attributes() + note("b", "4", step="E")
    xml = (
        f'<score-partwise><part id="P1"><measure>{one}</measure><measure>{note("c", step="D")}</measure></part>'
        f'<part id="P2"><measure>{two}</measure><measure>{note("d").replace("</note>", '<tie type="stop"/></note>')}</measure></part></score-partwise>'
    )
    compiled = compile_practice_score(xml)
    assert len({n.staff_id for n in compiled.notes}) == 2
    timeline = practice_timeline_from_compiled(compiled)
    assert timeline.moments[0].canonical_end_tick == 4


def test_inherited_meter_sound_and_dotted_direction_tempo():
    compiled = compile_practice_score(
        score(
            attributes(time=meter(3, 4)) + '<sound tempo="80"/>' + note(duration="3"),
            note("b", "3") + '<direction><offset sound="yes">-3</offset><direction-type><metronome>'
            "<beat-unit>eighth</beat-unit><beat-unit-dot/><per-minute>120</per-minute>"
            "</metronome></direction-type></direction>",
        )
    )
    assert len(compiled.meter_segments) == 1
    assert [(t.start_tick, t.bpm) for t in compiled.tempo_segments] == [(0, 80), (3, 90)]


def test_multiple_parts_share_measure_extent_with_one_supported_meter_timeline():
    one = attributes() + note(duration="4")
    two = attributes() + note("b", "2")
    xml = f'<score-partwise><part id="P1"><measure>{one}</measure><measure>{NEXT}{note("c")}</measure></part><part id="P2"><measure>{two}</measure><measure><attributes>{meter(3, 4)}</attributes>{note("d")}</measure></part></score-partwise>'
    compiled = compile_practice_score(xml)
    assert [n.onset_tick for n in compiled.notes] == [0, 0, 4, 4]
    assert compiled.tempo_segments[0].start_tick == compiled.meter_segments[-1].start_tick == 4
    with pytest.raises(PracticeScoreInvalidError):
        compile_practice_score(xml.replace(two, two.replace(meter(), meter(3, 4))))


BAD = [
    attributes("0") + note(),
    attributes("garbage") + note(),
    attributes("1/2") + note(),
    attributes() + note(duration="NaN"),
    attributes() + note(duration="1_0"),
    attributes("9007199254740992") + note(duration="1"),
    attributes() + note(duration="garbage"),
    attributes() + note(duration="-1"),
    attributes() + note(duration="0"),
    attributes() + note().replace("<duration>4</duration>", ""),
    attributes()
    + '<direction><offset sound="yes">bad</offset><sound tempo="100"/></direction>'
    + note(),
    attributes()
    + '<direction><offset sound="yes">-1</offset><sound tempo="100"/></direction>'
    + note(),
    attributes() + "<backup><duration>1</duration></backup>" + note(),
    attributes() + note(chord=True),
    attributes() + note().replace("</note>", '<tie type="start"/><tie type="start"/></note>'),
    attributes().replace(
        "</attributes>", "<transpose><chromatic>2</chromatic></transpose></attributes>"
    )
    + note(),
]


@pytest.mark.parametrize("body", BAD)
def test_malformed_chronology_fails_closed(body):
    with pytest.raises(PracticeScoreInvalidError):
        compile_practice_score(score(body))


@pytest.mark.parametrize("body", BAD)
def test_chronology_failure_is_invalid_score_at_bundle_boundary(tmp_path, body):
    path = tmp_path / "score.musicxml"
    path.write_bytes(score(body))
    service = bundle_service_for_notation(path.read_bytes())
    with pytest.raises(ValidationException) as caught:
        service.read_bundle(Mock(), "s", 1, "r")
    assert caught.value.code == "practice_score_invalid"
    assert caught.value.status_code == 422
    assert isinstance(caught.value.__cause__, PracticeScoreInvalidError)


@pytest.mark.parametrize("xml", [b"<score-partwise>", b"\xff"])
def test_unreadable_musicxml_is_invalid_score_not_infrastructure(tmp_path, xml):
    path = tmp_path / "score.musicxml"
    path.write_bytes(xml)
    service = bundle_service_for_notation(path.read_bytes())
    with pytest.raises(ValidationException) as caught:
        service.read_bundle(Mock(), "s", 1, "r")
    assert caught.value.code == "practice_score_invalid"
    assert caught.value.status_code == 422


@pytest.fixture(autouse=True)
def authorized_revision(monkeypatch):
    authorize_test_revision(monkeypatch)
