"""Immutable durable physical facts and saved Capture/archive aggregate admission."""

from dataclasses import FrozenInstanceError
import pytest
from app.modules.media_storage.facts import StoredObjectFacts
from app.modules.media_storage.persistence import object_from_row, object_to_row
from app.modules.performance_takes.aggregate import PerformanceTakeFacts
from tests.test_take_manifest import value as manifest_value


def facts():
    return StoredObjectFacts("private/candidate.webm", 42, "ab" * 32, "audio/webm")


def test_exact_object_facts_round_trip_and_immutable_value():
    original = facts()
    assert object_from_row(object_to_row(original)) == original
    with pytest.raises(FrozenInstanceError):
        original.byte_size = 1
    assert PerformanceTakeFacts(manifest_value(), original).recording_object is original


def test_exact_bytes_include_empty_objects_and_sha_is_not_globally_unique(
    postgres_engine,
):
    import hashlib
    from sqlalchemy import select
    from sqlalchemy.orm import Session
    from sqlalchemy.exc import IntegrityError
    from app.db.models import StoredObject

    empty = StoredObjectFacts.from_bytes(
        object_key="empty", content=b"", content_type="application/octet-stream"
    )
    assert empty.byte_size == 0
    assert empty.sha256 == hashlib.sha256(b"").hexdigest()
    engine = postgres_engine
    with Session(engine) as db:
        db.add_all(
            [
                object_to_row(empty),
                object_to_row(StoredObjectFacts("same-bytes", 0, empty.sha256, empty.content_type)),
            ]
        )
        db.commit()
        assert (
            len(db.scalars(select(StoredObject).where(StoredObject.sha256 == empty.sha256)).all())
            == 2
        )
        db.add(object_to_row(empty))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    engine.dispose()


def test_every_semantic_owner_has_explicit_physical_references():
    from app.db.models import (
        Upload,
        ImportArtifact,
        ScoreRevisionSource,
        ScoreRenderAsset,
        ScorePlaybackAsset,
        PracticeBundleRecord,
        PerformanceTake,
        User,
    )

    expected = {
        Upload: {"stored_object_id"},
        ImportArtifact: {"stored_object_id"},
        ScoreRevisionSource: {"stored_object_id"},
        ScoreRenderAsset: {"stored_object_id"},
        ScorePlaybackAsset: {"stored_object_id"},
        PerformanceTake: {"recording_object_id"},
        PracticeBundleRecord: {"prepared_musicxml_object_id", "artifact_object_id"},
        User: {"avatar_object_id"},
    }
    for owner, columns in expected.items():
        actual = {
            fk.parent.name
            for fk in owner.__table__.foreign_keys
            if fk.target_fullname == "stored_objects.id"
        }
        assert actual == columns
        for column in columns:
            assert owner.__table__.c[column].nullable is (owner in (User, PracticeBundleRecord))


@pytest.mark.parametrize(
    "field,bad",
    [
        ("object_key", ""),
        ("object_key", "/object"),
        ("object_key", "object/"),
        ("object_key", "object//bytes"),
        ("object_key", "object/../bytes"),
        ("byte_size", -1),
        ("byte_size", 1.5),
        ("byte_size", True),
        ("sha256", "A" * 64),
        ("sha256", "g" * 64),
        ("sha256", "a" * 63),
        ("sha256", "a" * 65),
        ("content_type", ""),
        ("content_type", "AUDIO/WEBM"),
        ("content_type", "audio/webm;codecs=opus"),
        ("content_type", "not-mime"),
    ],
)
def test_persisted_physical_corruption_fails_closed(field, bad):
    row = object_to_row(facts())
    setattr(row, field, bad)
    with pytest.raises(ValueError):
        object_from_row(row)


@pytest.mark.parametrize("update", [{"byte_size": 43}, {"content_type": "audio/mp4"}])
def test_aggregate_rejects_archive_that_does_not_preserve_capture(update):
    from dataclasses import replace

    with pytest.raises(ValueError):
        PerformanceTakeFacts(manifest_value(), replace(facts(), **update))


def test_physical_schema_and_dependency_ownership():
    import ast
    from pathlib import Path
    from sqlalchemy import UniqueConstraint
    from app.db.models import StoredObject, PerformanceTake

    blob, take = StoredObject.__table__, PerformanceTake.__table__
    assert set(blob.columns.keys()) == {
        "id",
        "object_key",
        "byte_size",
        "sha256",
        "provider_etag",
        "transport_checksum_algorithm",
        "transport_checksum",
        "content_type",
        "created_at",
    }
    assert set(take.columns.keys()) == {
        "id",
        "manifest_id",
        "media_status",
        "owner_user_id",
        "recording_object_id",
        "linked_score_id",
        "created_at",
        "updated_at",
    }
    assert not blob.foreign_keys
    assert not take.c.recording_object_id.nullable
    assert any(
        isinstance(c, UniqueConstraint)
        and [column.name for column in c.columns] == ["recording_object_id"]
        for c in take.constraints
    )
    assert any(
        isinstance(c, UniqueConstraint) and [column.name for column in c.columns] == ["object_key"]
        for c in blob.constraints
    )
    root = Path(__file__).parents[1] / "app/modules/media_storage"
    allowed = {"dataclasses", "re", "hashlib", "app.db.models.stored_object", "facts"}
    for file in (root / "facts.py", root / "persistence.py"):
        for node in ast.walk(ast.parse(file.read_text())):
            if isinstance(node, ast.ImportFrom):
                assert node.module in allowed
            if isinstance(node, ast.Import):
                assert all(alias.name in allowed for alias in node.names)
