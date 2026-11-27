"""Stateless HTTP compilation returns the exact admitted document and rational plan."""

from fractions import Fraction

import pytest
from tests.support.browser import BrowserTestClient as TestClient

from app.platform.db.dependencies import get_db
from app.runtime.customer_api.deps import get_current_user
from app.core.exceptions import ValidationException
from app.runtime.customer_api.main import create_app
from app.modules.playback.performance_plan_service import compile_performance_plan
from app.modules.playback.performance_plan_schemas import PerformancePlanRead
from app.processing.musicxml.admission import admit_musicxml_document
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_plan import build_performance_plan
from tests.support.canonical_musicxml import measure, score, sound
from tests.support.written_realization_sources import SOURCES, LOSSY_SOURCES, PROFILE_SOURCES

PATH = "/api/v1/playback/performance-plan"


@pytest.fixture
def client():
    app = create_app()

    def no_infrastructure():
        pytest.fail("A supplied-document transform must not access DB/auth dependencies")

    app.dependency_overrides[get_db] = no_infrastructure
    app.dependency_overrides[get_current_user] = no_infrastructure
    return TestClient(app)


def fraction(value):
    return Fraction(value["numerator"], value["denominator"])


def test_unauthed_plan_has_exact_rationals_and_no_persistence_identity(client):
    xml = score([measure(0, {1: sound('tempo="100.5"')})]).replace("<divisions>1", "<divisions>3")
    response = client.post(PATH, json={"musicxml": xml})
    assert response.status_code == 200
    body = response.json()
    assert body["musicxml"] == xml
    assert set(body) == {
        "musicxml",
        "performance_end",
        "initial_tempo_bpm",
        "occurrences",
        "tempo_events",
    }
    assert body["performance_end"] == {"numerator": 4, "denominator": 3}
    assert body["tempo_events"][0]["performance_position"] == {"numerator": 1, "denominator": 3}
    assert body["tempo_events"][0]["bpm"] == {"numerator": 201, "denominator": 2}
    result = build_performance_plan(parse_score_semantics(body["musicxml"]))
    assert fraction(body["performance_end"]) == result.projection.end
    for read, event in zip(body["tempo_events"], result.tempo_events, strict=True):
        assert fraction(read["performance_position"]) == event.performance_position
        assert fraction(read["bpm"]) == event.bpm
        assert read["occurrence_ordinal"] == event.occurrence_ordinal
    for read, occurrence in zip(body["occurrences"], result.projection.occurrences, strict=True):
        assert (read["ordinal"], read["measure_index"], read["visit"]) == (
            occurrence.ordinal,
            occurrence.measure_index,
            occurrence.visit,
        )
        for key in ("written_start", "written_end", "performance_start", "performance_end"):
            assert fraction(read[key]) == getattr(occurrence, key)
    assert PerformancePlanRead.model_validate_json(response.text).model_dump() == body


def test_materialized_document_is_the_single_returned_semantic_source(client):
    mark = "<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>50</per-minute></metronome></direction-type></direction>"
    xml = score([measure(0, {2: mark})])
    response = client.post(PATH, json={"musicxml": xml})
    assert response.status_code == 200
    body = response.json()
    assert body["musicxml"] != xml
    assert body["musicxml"].encode() == admit_musicxml_document(xml.encode())
    assert client.post(PATH, json={"musicxml": body["musicxml"]}).json() == body
    plan = build_performance_plan(parse_score_semantics(body["musicxml"]))
    assert [
        (fraction(t["performance_position"]), fraction(t["bpm"])) for t in body["tempo_events"]
    ] == [(t.performance_position, t.bpm) for t in plan.tempo_events]


@pytest.mark.parametrize(
    "body",
    [
        "<score-timewise/>",
        "<broken",
        "<score-partwise><part><measure><backup><duration>1</duration></backup></measure></part></score-partwise>",
    ],
)
def test_invalid_source_uses_existing_admission_error(client, body):
    response = client.post(PATH, json={"musicxml": body})
    assert response.status_code == 422
    assert response.json()["code"] == "revision_content_invalid"


@pytest.mark.parametrize(
    "markup,reason",
    [
        (sound('tempo="100" time-only="2"'), "unsupported_time_only_playback"),
        (
            sound('dacapo="yes"')
            + '<barline location="left"><ending number="1" type="start"/></barline>',
            "unsupported_jump_ending_interaction",
        ),
        (sound('forward-repeat="yes"'), "unclosed_repeat"),
    ],
)
def test_unsupported_performance_is_distinct_from_source_invalidity(client, markup, reason):
    xml = score([measure(0, {0: markup})])
    assert admit_musicxml_document(xml.encode()) == xml.encode()
    response = client.post(PATH, json={"musicxml": xml})
    assert response.status_code == 422
    assert response.json()["code"] == "score_playback_failed"
    with pytest.raises(ValidationException) as exc:
        compile_performance_plan(xml)
    assert exc.value.details == {"reason": reason}


def test_missing_tempo_response_has_initial_state_and_no_tempo_fact(client):
    xml = score([measure(0)])
    body = client.post(PATH, json={"musicxml": xml}).json()
    assert body["initial_tempo_bpm"] == {"numerator": 80, "denominator": 1}
    assert body["tempo_events"] == []
    assert body["musicxml"] == xml


@pytest.mark.parametrize("xml,reason", LOSSY_SOURCES, ids=[r for _, r in LOSSY_SOURCES])
def test_renderer_loss_is_a_playback_capability_error_not_source_invalidity(client, xml, reason):
    assert parse_score_semantics(admit_musicxml_document(xml.encode())).end == 4
    response = client.post(PATH, json={"musicxml": xml})
    assert response.status_code == 422
    assert response.json()["code"] == "score_playback_failed"
    with pytest.raises(ValidationException) as exc:
        compile_performance_plan(xml)
    assert exc.value.details == {"reason": reason}


@pytest.mark.parametrize("name", ["piano", "duet", "dynamics", "pedal"])
def test_faithful_realization_sources_remain_available_without_storage_or_auth(client, name):
    response = client.post(PATH, json={"musicxml": SOURCES[name]})
    assert response.status_code == 200
    assert response.json()["musicxml"] == SOURCES[name]


@pytest.mark.parametrize("name,case", PROFILE_SOURCES.items(), ids=PROFILE_SOURCES)
def test_playable_plan_http_boundary_applies_the_closed_source_profile(client, name, case):
    xml = case["musicxml"]
    admitted = admit_musicxml_document(xml.encode())
    assert parse_score_semantics(admitted).end > 0
    response = client.post(PATH, json={"musicxml": xml})
    if case["reason"]:
        assert response.status_code == 422
        assert response.json()["code"] == "score_playback_failed"
        with pytest.raises(ValidationException) as exc:
            compile_performance_plan(xml)
        assert exc.value.details == {"reason": case["reason"]}
    else:
        assert response.status_code == 200
        assert response.json()["musicxml"].encode() == admitted


def test_unclassified_source_extension_has_a_playback_capability_error(client):
    xml = SOURCES["piano"].replace('<note id="n0"', '<sound future-gain="2"/><note id="n0"')
    assert parse_score_semantics(admit_musicxml_document(xml.encode())).end == 4
    response = client.post(PATH, json={"musicxml": xml})
    assert response.status_code == 422
    assert response.json()["code"] == "score_playback_failed"
