from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.db.models import User, Score, ScoreRevision, ScoreRevisionMetadata
from app.modules.metadata.domain import MetadataStatus
from app.modules.revisions.domain import RevisionOrigin
from app.modules.metadata.service import MetadataProjectionService
from app.modules.metadata.schemas import MetadataRead
from app.processing.musicxml.metadata import (
    KeySignatureEvent,
    TimeSignatureEvent,
    TempoEvent,
    MusicXMLMetadata,
)

from app.processing.musicxml import MetadataExtractionError, extract_musicxml_metadata
from app.processing.musicxml.notation_title import extract_notation_title

FIXTURES = Path(__file__).parent / "fixtures" / "musicxml"


@pytest.mark.parametrize(
    "work,expected",
    [
        ("", None),
        ("<work><work-title> \n </work-title></work>", None),
        ("<work><work-title>  月光 — Sonata  </work-title></work>", "月光 — Sonata"),
    ],
)
def test_notation_title_uses_work_metadata_and_preserves_content(work, expected):
    from tests.test_score_revision_services import MUSICXML_1

    content = MUSICXML_1.decode().replace(
        "<part-list>",
        work
        + "<credit><credit-type>title</credit-type><credit-words>Visible credit</credit-words></credit><part-list>",
    )
    assert extract_notation_title(content) == expected
    assert extract_musicxml_metadata(content).notation_title == expected


def test_notation_title_accepts_a_namespaced_canonical_document():
    assert (
        extract_notation_title(
            '<score-partwise xmlns="http://www.musicxml.org/ns/musicxml"><work><work-title> Étude </work-title></work></score-partwise>'
        )
        == "Étude"
    )


def test_metadata_projection_applies_and_clears_derived_notation_title():
    from app.db.models import ScoreRevisionMetadata
    from app.modules.metadata.service import MetadataProjectionService
    from tests.test_score_revision_services import MUSICXML_1

    result = extract_musicxml_metadata(
        MUSICXML_1.decode().replace(
            "<part-list>", "<work><work-title>Notation</work-title></work><part-list>"
        )
    )
    projection = ScoreRevisionMetadata(revision_id=1)
    MetadataProjectionService._apply_result(projection, result)
    assert projection.notation_title == "Notation"
    MetadataProjectionService._mark_failed(projection, "metadata_invalid")
    assert projection.notation_title is None


def test_metadata_extractor_handles_repeats_key_meter_tempo_and_parts() -> None:
    result = extract_musicxml_metadata((FIXTURES / "score-domain-metadata.musicxml").read_bytes())

    assert all(type(event) is KeySignatureEvent for event in result.key_signature_events)
    assert all(type(event) is TimeSignatureEvent for event in result.time_signature_events)
    assert all(type(event) is TempoEvent for event in result.tempo_events)
    assert result.notation_title == "Metadata Contract"
    assert result.measure_count == 4
    assert result.part_count == 2
    assert result.primary_key_fifths == 0
    assert result.primary_mode == "major"
    assert [event.fifths for event in result.key_signature_events if event.part == 1] == [
        0,
        1,
    ]
    assert [event.beats for event in result.time_signature_events if event.part == 1] == [
        4,
        3,
    ]
    assert [event.bpm for event in result.tempo_events] == [120.0, 90.0]
    assert result.extractor_version == "musicxml-metadata-v1"


def test_metadata_extractor_classifies_invalid_values() -> None:
    with pytest.raises(MetadataExtractionError) as error:
        extract_musicxml_metadata(
            (FIXTURES / "score-domain-invalid-metadata.musicxml").read_bytes()
        )

    assert str(error.value) == "invalid_key_fifths"


EVENT_FIELDS = {
    "key_signature_events": KeySignatureEvent,
    "time_signature_events": TimeSignatureEvent,
    "tempo_events": TempoEvent,
}


def projected_metadata():
    result = extract_musicxml_metadata((FIXTURES / "score-domain-metadata.musicxml").read_bytes())
    projection = ScoreRevisionMetadata(revision_id=1)
    MetadataProjectionService._apply_result(projection, result)
    return projection, result


def test_metadata_events_encode_exact_json_shapes_in_written_order():
    projection, _ = projected_metadata()
    assert projection.key_signature_events == [
        {"part": part, "measure": measure, "fifths": fifths, "mode": "major"}
        for part in (1, 2)
        for measure, fifths in [("1", 0), ("3", 1)]
    ]
    assert projection.time_signature_events == [
        {"part": part, "measure": measure, "beats": beats, "beat_type": 4}
        for part in (1, 2)
        for measure, beats in [("1", 4), ("3", 3)]
    ]
    assert projection.tempo_events == [
        {"part": 1, "measure": "1", "offset_quarters": 0.0, "bpm": 120.0},
        {"part": 1, "measure": "3", "offset_quarters": 0.0, "bpm": 90.0},
    ]
    import json

    assert json.loads(json.dumps(projection.tempo_events)) == projection.tempo_events


@pytest.fixture
def persisted_projection(postgres_engine):
    with Session(postgres_engine) as db:
        user = User(email="metadata@example.test", password_hash="hash")
        db.add(user)
        db.flush()
        score = Score(score_uuid="metadata-score", owner_user_id=user.id, display_title="Metadata")
        db.add(score)
        db.flush()
        revision = ScoreRevision(
            revision_uuid="metadata-revision",
            score_id=score.id,
            revision_number=1,
            content_hash="a" * 64,
            origin=RevisionOrigin.EDIT,
        )
        db.add(revision)
        db.flush()
        projection, result = projected_metadata()
        projection.revision_id = revision.id
        db.add(projection)
        db.commit()
        db.expire_all()
        yield db, revision, projection, result


def test_postgresql_jsonb_round_trip_decodes_the_canonical_public_event_types(persisted_projection):
    db, revision, projection, result = persisted_projection
    db.refresh(projection)
    read = MetadataProjectionService.to_read(revision, projection)
    for field, event_type in EVENT_FIELDS.items():
        assert all(type(event) is dict for event in getattr(projection, field))
        assert all(type(event) is event_type for event in getattr(read, field))
        assert getattr(read, field) == getattr(result, field)
        assert read.model_dump(mode="json")[field] == getattr(projection, field)
    assert projection.extractor_version == "musicxml-metadata-v1"
    MetadataProjectionService._mark_failed(projection, "metadata_invalid")
    db.commit()
    db.expire_all()
    failed = MetadataProjectionService.to_read(revision, projection)
    assert failed.status is MetadataStatus.FAILED
    for field in EVENT_FIELDS:
        assert getattr(failed, field) == []


@pytest.mark.parametrize("field", EVENT_FIELDS)
@pytest.mark.parametrize(
    "corruption", ["missing", "extra", "numeric_string", "wrong_measure", "bool"]
)
def test_persisted_event_decode_rejects_invalid_shapes_and_types(field, corruption):
    projection, _ = projected_metadata()
    event = dict(getattr(projection, field)[0])
    numeric_field = {
        "key_signature_events": "fifths",
        "time_signature_events": "beats",
        "tempo_events": "bpm",
    }[field]
    if corruption == "missing":
        del event[numeric_field]
    elif corruption == "extra":
        event["unknown"] = True
    elif corruption == "numeric_string":
        event[numeric_field] = "1"
    elif corruption == "wrong_measure":
        event["measure"] = 1
    else:
        event[numeric_field] = True
    setattr(projection, field, [event])
    with pytest.raises(ValidationError):
        MetadataProjectionService.to_read(ScoreRevision(revision_uuid="revision"), projection)


@pytest.mark.parametrize("field", EVENT_FIELDS)
@pytest.mark.parametrize("payload", [None, {}, [None], [{}]])
def test_persisted_event_decode_requires_a_list_of_complete_events(field, payload):
    projection, _ = projected_metadata()
    setattr(projection, field, payload)
    with pytest.raises(ValidationError):
        MetadataProjectionService.to_read(ScoreRevision(revision_uuid="revision"), projection)


def test_corrupt_jsonb_is_rejected_after_postgresql_reload(persisted_projection):
    db, revision, projection, _ = persisted_projection
    projection.key_signature_events = [{"part": 1, "measure": "1", "mode": "major"}]
    db.commit()
    db.expire_all()
    with pytest.raises(ValidationError):
        MetadataProjectionService.to_read(revision, projection)


def test_metadata_domain_and_public_events_share_one_fixed_shape_authority():
    from typing import get_type_hints
    from app.runtime.customer_api.main import app

    domain_fields = get_type_hints(MusicXMLMetadata)
    schemas = app.openapi()["components"]["schemas"]
    for field, event_type in EVENT_FIELDS.items():
        assert domain_fields[field] == list[event_type]
        assert MetadataRead.model_fields[field].annotation == list[event_type]
        items = schemas["MetadataRead"]["properties"][field]["items"]
        assert items == {"$ref": f"#/components/schemas/{event_type.__name__}"}
        event_schema = schemas[event_type.__name__]
        assert event_schema["additionalProperties"] is False
        assert set(event_schema["required"]) == set(event_type.model_fields)
        assert set(event_schema["properties"]) == set(event_type.model_fields)


def test_metadata_events_preserve_open_mode_and_measure_fallback():
    xml = (
        (FIXTURES / "score-domain-metadata.musicxml")
        .read_text()
        .replace('number="1"', "")
        .replace("<mode>major</mode>", "<mode>dorian</mode>")
    )
    result = extract_musicxml_metadata(xml)
    assert result.key_signature_events[0].measure == "1"
    assert result.key_signature_events[0].mode == "dorian"
    assert result.primary_mode == "dorian"


def test_metadata_tempo_offsets_keep_six_decimal_projection():
    from tests.test_musicxml_tempo import score, rest

    xml = score(
        '<direction><offset sound="yes">1</offset><sound tempo="90"/></direction>' + rest(8)
    )
    xml = xml.replace("<divisions>2</divisions>", "<divisions>3</divisions>")
    assert extract_musicxml_metadata(xml).tempo_events[0].offset_quarters == 0.333333


@pytest.mark.parametrize("source", ["repeats", "dc", "ds", "post_jump"])
def test_written_metadata_does_not_construct_performance_chronology(monkeypatch, source):
    from app.score_semantics import performance_plan, performance_navigation
    from tests.support.canonical_musicxml import dc_score, ds_score, jump_measures, score

    def unexpected_performance_construction(*args, **kwargs):
        pytest.fail("written metadata must not construct performed chronology")

    monkeypatch.setattr(
        performance_plan,
        "build_performance_plan",
        unexpected_performance_construction,
    )
    monkeypatch.setattr(
        performance_navigation,
        "project_performance_occurrences",
        unexpected_performance_construction,
    )
    xml = {
        "repeats": (FIXTURES / "score-domain-metadata.musicxml").read_bytes(),
        "dc": dc_score(),
        "ds": ds_score(),
        "post_jump": score(jump_measures(None)),
    }[source]
    from app.score_semantics.musicxml_score import parse_score_semantics

    model = parse_score_semantics(xml)
    result = extract_musicxml_metadata(xml)
    assert result.measure_count == len(model.measures)
    assert result.part_count == len(model.parts)
    assert len(result.tempo_events) == len(model.tempos)
    assert [event.part for event in result.key_signature_events] == [
        key.part_index + 1
        for key in sorted(model.keys, key=lambda key: (key.part_index, key.measure_index))
    ]


def test_metadata_schema_contains_only_written_projection_facts():
    from dataclasses import fields
    from app.db.models import ScorePlaybackAsset
    from app.runtime.customer_api.main import app

    expected = {
        "measure_count",
        "part_count",
        "primary_key_fifths",
        "primary_mode",
        "key_signature_events",
        "time_signature_events",
        "tempo_events",
        "extractor_version",
        "notation_title",
    }
    assert {field.name for field in fields(MusicXMLMetadata)} == expected
    read_fields = (expected - {"extractor_version"}) | {"revision_id", "status", "computed_at"}
    assert set(MetadataRead.model_fields) == read_fields
    assert set(app.openapi()["components"]["schemas"]["MetadataRead"]["properties"]) == read_fields
    assert set(ScoreRevisionMetadata.__table__.columns.keys()) == expected | {
        "revision_id",
        "status",
        "error_code",
        "computed_at",
    }
    assert "duration_ms" in ScorePlaybackAsset.__table__.columns
