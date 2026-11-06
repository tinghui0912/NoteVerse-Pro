"""Immutable durable physical facts and saved Capture/archive aggregate admission."""

from dataclasses import FrozenInstanceError
import pytest
from app.modules.media.blob import MediaBlobFacts
from app.modules.media.persistence import blob_from_row, blob_to_row
from app.modules.performance_takes.aggregate import SavedTakeFacts
from tests.test_take_manifest import value as manifest_value


def facts():
    return MediaBlobFacts("local", "private/candidate.webm", 42, "ab" * 32, "audio/webm")


def test_exact_blob_facts_round_trip_and_immutable_value():
    original = facts()
    assert blob_from_row(blob_to_row(original)) == original
    with pytest.raises(FrozenInstanceError):
        original.byte_size = 1
    assert SavedTakeFacts(manifest_value(), original).blob is original


@pytest.mark.parametrize(
    "field,bad",
    [
        ("storage_backend", ""),
        ("storage_backend", " "),
        ("object_key", ""),
        ("byte_size", 0),
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
    row = blob_to_row(facts())
    setattr(row, field, bad)
    with pytest.raises(ValueError):
        blob_from_row(row)


@pytest.mark.parametrize("update", [{"byte_size": 43}, {"content_type": "audio/mp4"}])
def test_aggregate_rejects_archive_that_does_not_preserve_capture(update):
    from dataclasses import replace

    with pytest.raises(ValueError):
        SavedTakeFacts(manifest_value(), replace(facts(), **update))


def test_physical_schema_and_dependency_ownership():
    import ast
    from pathlib import Path
    from sqlalchemy import UniqueConstraint
    from app.db.models import MediaBlob, PerformanceTake

    blob, take = MediaBlob.__table__, PerformanceTake.__table__
    assert set(blob.columns.keys()) == {
        "id",
        "storage_backend",
        "object_key",
        "byte_size",
        "sha256",
        "content_type",
        "created_at",
    }
    assert set(take.columns.keys()) == {
        "id",
        "manifest_id",
        "media_blob_id",
        "linked_score_id",
        "deletion_status",
        "created_at",
        "updated_at",
    }
    assert not blob.foreign_keys
    assert not take.c.media_blob_id.nullable
    assert any(
        isinstance(c, UniqueConstraint)
        and [column.name for column in c.columns] == ["media_blob_id"]
        for c in take.constraints
    )
    assert any(
        isinstance(c, UniqueConstraint)
        and [column.name for column in c.columns] == ["storage_backend", "object_key"]
        for c in blob.constraints
    )
    root = Path(__file__).parents[1] / "app/modules/media"
    allowed = {"dataclasses", "re", "app.db.models.media_blob", "blob"}
    for file in root.glob("*.py"):
        for node in ast.walk(ast.parse(file.read_text())):
            if isinstance(node, ast.ImportFrom):
                assert node.module in allowed
            if isinstance(node, ast.Import):
                assert all(alias.name in allowed for alias in node.names)
