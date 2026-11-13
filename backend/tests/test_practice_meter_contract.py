from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from tests.practice_bundle_fixtures import bundle_service_for_notation, authorize_test_revision
import pytest
from pydantic import ValidationError

from app.core.exceptions import ValidationException
from app.modules.practice.bundle.compiler import PracticeBundleCompiler
from app.modules.practice.score.generated.artifact_transport import PracticeScoreArtifactRead
from app.modules.practice.score.artifact_validation import validate_practice_score_artifact
from app.modules.practice.score.piano_key import PracticeScoreInvalidError
from app.modules.practice.score.domain import (
    MAX_JSON_SAFE_INTEGER,
    PracticeScoreTimeline,
    PracticeMeterSegment,
)


def time(numerator=4, denominator=4):
    return f"<time><beats>{numerator}</beats><beat-type>{denominator}</beat-type></time>"


def xml(initial, later="", tempo=""):
    # Key signature is intentionally absent: physical piano identity owns pitch.
    return f"""<score-partwise version="3.1">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions>{initial}</attributes>
        <note id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><type>half</type><dot/></note>
      </measure><measure number="2"><attributes>{later}</attributes>{tempo}
        <note id="n2"><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><type>half</type><dot/></note>
      </measure></part></score-partwise>""".encode()


def build(value):
    return PracticeBundleCompiler().compile(canonical_musicxml=value)


@pytest.mark.parametrize(
    "initial,later,expected",
    [
        (time(), "", [(0, 4, 4)]),
        (time(3, 4), "", [(0, 3, 4)]),
        (time(3, 4), time(6, 8), [(0, 3, 4), (6, 6, 8)]),
    ],
)
def test_explicit_initial_meter_and_inherited_or_changed_meter(initial, later, expected):
    bundle = build(xml(initial, later))
    artifact = PracticeScoreArtifactRead.model_validate(bundle.artifact.value)
    assert [(m.startTick, m.numerator, m.denominator) for m in artifact.meterSegments] == expected
    assert all(
        set(m.model_dump()) == {"startTick", "numerator", "denominator"}
        for m in artifact.meterSegments
    )
    assert artifact.notes[0].pianoKey == 60
    assert b"<key>" not in bundle.prepared_musicxml.data
    assert artifact.scoreTempoSegments == []


INVALID = [
    ("", ""),
    ("", time(3, 4)),
    (time("invalid", 4), ""),
    (time(3, "invalid"), ""),
    (time("9" * 400, 4), ""),
    (time(4, "9" * 400), ""),
    (time("3.5", 4), ""),
    (time(0, 4), ""),
    (time(4, 0), ""),
    ("<time><senza-misura/></time>", ""),
    (time(), "<time><senza-misura/></time>"),
    (time(), time(3, "invalid")),
]


@pytest.mark.parametrize("initial,later", INVALID)
def test_invalid_meter_fails_before_timeline_projection(tmp_path, initial, later):
    path = tmp_path / "prepared.musicxml"
    path.write_bytes(xml(initial, later))
    with patch("app.modules.practice.bundle.compiler.practice_timeline_from_compiled") as load:
        with pytest.raises(PracticeScoreInvalidError):
            build(path.read_bytes())
    load.assert_not_called()
    with pytest.raises(PracticeScoreInvalidError):
        build(path.read_bytes())


@pytest.mark.asyncio
@pytest.mark.parametrize("initial,later", INVALID)
async def test_real_builder_meter_failure_maps_to_existing_invalid_score(tmp_path, initial, later):
    path = tmp_path / "score.musicxml"
    path.write_bytes(xml(initial, later))
    service = bundle_service_for_notation(path.read_bytes())
    with pytest.raises(ValidationException) as caught:
        await service.read_bundle(AsyncMock(), "s", 1, "r")
    assert caught.value.code == "practice_score_invalid"
    assert caught.value.status_code == 422
    assert isinstance(caught.value.__cause__, PracticeScoreInvalidError)


def test_no_key_and_no_tempo_are_valid_but_delayed_explicit_tempo_is_retained():
    no_tempo = build(xml(time(3, 4))).artifact.value
    assert no_tempo["scoreTempoSegments"] == []
    delayed = build(
        xml(time(3, 4), tempo='<direction><sound tempo="100"/></direction>')
    ).artifact.value
    assert delayed["scoreTempoSegments"] == [{"startTick": 3, "bpm": 100}]
    assert set(no_tempo) == {
        "schemaVersion",
        "ticksPerQuarter",
        "artifactId",
        "notes",
        "events",
        "moments",
        "meterSegments",
        "scoreTempoSegments",
        "scoreEndTick",
    }
    assert set(PracticeScoreArtifactRead.model_fields) == set(no_tempo)


@pytest.mark.parametrize(
    "meters",
    [
        [],
        [
            {
                "startTick": 1,
                "numerator": 4,
                "denominator": 4,
            }
        ],
    ],
)
def test_score_semantics_reject_missing_initial_meter_without_mutation(meters):
    from copy import deepcopy

    value = {**build(xml(time())).artifact.value, "meterSegments": meters}
    before = deepcopy(value)
    with pytest.raises(ValueError):
        validate_practice_score_artifact(
            PracticeScoreArtifactRead.model_validate(value).model_dump()
        )
    assert value == before


def test_timeline_meter_access_fails_closed_without_initial_meter():
    timeline = PracticeScoreTimeline((), (), (), 0, 1, ())
    with pytest.raises(PracticeScoreInvalidError):
        timeline.meter_at(0)
    with pytest.raises(PracticeScoreInvalidError):
        replace(timeline, meter_segments=(PracticeMeterSegment(1, 3, 4),)).meter_at(0)


def test_meter_duration_uses_shared_canonical_score_beat_witnesses():
    import json
    import os
    from pathlib import Path

    root = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
    cases = json.loads(
        (
            root / "apps/customer-web/src/lib/practice/__fixtures__/meter-duration-cases.json"
        ).read_text()
    )
    for case in cases:
        assert (
            PracticeMeterSegment(0, case["numerator"], case["denominator"]).measure_duration_ticks(
                case["ticksPerQuarter"]
            )
            == case["durationTicks"]
        )


@pytest.mark.parametrize(
    "meter",
    [
        {"startTick": 0, "numerator": 0, "denominator": 4},
        {"startTick": 0, "numerator": True, "denominator": 4},
        {"startTick": 0, "numerator": 3.5, "denominator": 4},
        {"startTick": 0, "numerator": 3, "denominator": 0},
        {"startTick": 0, "numerator": 3, "denominator": "4"},
        {"startTick": 0, "numerator": 3, "denominator": 4, "unexpectedField": 1},
        {"startTick": 0, "numerator": 3},
    ],
)
def test_meter_transport_exact_facts_fail_closed_without_mutation(meter):
    from copy import deepcopy

    value = {**build(xml(time())).artifact.value, "meterSegments": [meter]}
    before = deepcopy(value)
    with pytest.raises(ValidationError):
        PracticeScoreArtifactRead.model_validate(value)
    assert value == before


@pytest.mark.parametrize(
    "numerator,denominator",
    [
        (MAX_JSON_SAFE_INTEGER, 4),
        (MAX_JSON_SAFE_INTEGER, MAX_JSON_SAFE_INTEGER),
    ],
)
def test_meter_domain_admits_portable_integer_boundary(numerator, denominator):
    meter = PracticeMeterSegment(0, numerator, denominator)
    assert meter.numerator == numerator
    assert meter.denominator == denominator
    assert (meter.numerator, meter.denominator) == (numerator, denominator)


@pytest.mark.parametrize("field", ["numerator", "denominator"])
@pytest.mark.parametrize(
    "value", [0, -1, MAX_JSON_SAFE_INTEGER + 1, MAX_JSON_SAFE_INTEGER + 2, True, 4.0, "4"]
)
def test_meter_domain_requires_positive_json_safe_integer_facts(field, value):
    facts = {"numerator": MAX_JSON_SAFE_INTEGER, "denominator": MAX_JSON_SAFE_INTEGER}
    facts[field] = value
    if type(value) is int and value > MAX_JSON_SAFE_INTEGER:
        # This ratio has an ordinary positive duration; portability owns rejection.
        assert round(facts["numerator"] * 4 / facts["denominator"], 6) == 4
    with pytest.raises(PracticeScoreInvalidError, match="positive JSON-safe integers"):
        PracticeMeterSegment(0, **facts)


@pytest.mark.parametrize(
    "numerator,denominator",
    [
        (MAX_JSON_SAFE_INTEGER, 4),
        (1, MAX_JSON_SAFE_INTEGER),
    ],
)
def test_artifact_transport_preserves_safe_meter_integers_without_mutation(numerator, denominator):
    from copy import deepcopy
    import json

    value = {
        **build(xml(time())).artifact.value,
        "ticksPerQuarter": 1 if denominator == 4 else denominator,
        "meterSegments": [{"startTick": 0, "numerator": numerator, "denominator": denominator}],
    }
    before = deepcopy(value)
    for parsed in (
        PracticeScoreArtifactRead.model_validate(value),
        PracticeScoreArtifactRead.model_validate_json(json.dumps(value)),
    ):
        assert parsed.meterSegments[0].numerator == numerator
        assert parsed.meterSegments[0].denominator == denominator
    assert value == before


@pytest.mark.parametrize("field", ["numerator", "denominator"])
@pytest.mark.parametrize(
    "value", [0, -1, MAX_JSON_SAFE_INTEGER + 1, MAX_JSON_SAFE_INTEGER + 2, True, 4.0, "4"]
)
def test_artifact_transport_rejects_nonportable_meter_integers_without_coercion(field, value):
    from copy import deepcopy
    import json

    meter = {
        "startTick": 0,
        "numerator": MAX_JSON_SAFE_INTEGER,
        "denominator": MAX_JSON_SAFE_INTEGER,
    }
    meter[field] = value
    artifact = {**build(xml(time())).artifact.value, "meterSegments": [meter]}
    before = deepcopy(artifact)
    with pytest.raises(ValidationError):
        PracticeScoreArtifactRead.model_validate(artifact)
    with pytest.raises(ValidationError):
        PracticeScoreArtifactRead.model_validate_json(json.dumps(artifact))
    assert artifact == before


def test_meter_openapi_exposes_portable_integer_bounds():
    from app.modules.practice.score.generated.artifact_transport import (
        PracticeScoreMeterSegmentRead,
    )

    properties = PracticeScoreMeterSegmentRead.model_json_schema()["properties"]
    for field in ("numerator", "denominator"):
        assert properties[field]["type"] == "integer"
        assert properties[field]["minimum"] == 1
        assert properties[field]["maximum"] == MAX_JSON_SAFE_INTEGER


@pytest.mark.parametrize(
    "numerator,denominator",
    [
        (MAX_JSON_SAFE_INTEGER + 1, MAX_JSON_SAFE_INTEGER),
        (MAX_JSON_SAFE_INTEGER, MAX_JSON_SAFE_INTEGER + 1),
    ],
)
def test_unsafe_musicxml_meter_is_invalid_score_over_http(tmp_path, numerator, denominator):
    from app.core.http_application import HttpApplication
    from fastapi.testclient import TestClient
    from app.api.deps import get_current_user, get_db
    from app.core.exception_handlers import register_exception_handlers
    from app.modules.practice.bundle.router import router, get_practice_bundle_service

    assert round(numerator * 4 / denominator, 6) == 4
    path = tmp_path / "score.musicxml"
    path.write_bytes(xml(time(numerator, denominator)))
    service = bundle_service_for_notation(path.read_bytes())
    app = HttpApplication()
    register_exception_handlers(app)
    app.include_router(router, prefix="/api/v1/practice")
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_practice_bundle_service] = lambda: service
    with patch.object(service.compiler, "compile", wraps=service.compiler.compile) as builder:
        response = TestClient(app).get("/api/v1/practice/scores/s/revisions/r/bundle")
    builder.assert_called_once()
    assert response.status_code == 422
    assert response.json()["code"] == "practice_score_invalid"


@pytest.fixture(autouse=True)
def authorized_revision(monkeypatch):
    authorize_test_revision(monkeypatch)
