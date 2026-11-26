"""Bindings own Bundle lifetime; each representation retires independently."""

from app.modules.practice.bundle.states import PracticeBundleStatus

from tests.support.practice_bundle import bind_bundle

from datetime import timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import select, delete
from app.core.config import settings
from app.db.models import (
    StoredObject,
    StoredObjectRetirement,
    PracticeBundleRecord,
    ScoreRevisionPracticeBinding,
    Upload,
)
from app.modules.practice.bundle.retention import practice_bundle_retention
from app.modules.media_storage.retirement import retire_after_release
from app.shared.time import utc_now
from tests.test_performance_takes import (
    test_env as test_env,
    _create_default_bundle,
    _create_default_take,
    _canonical_bundle,
)
from tests.support.retirement import drain_retirements


def test_bundle_gc_protects_each_representation_shared_elsewhere(test_env):
    db, storage, user, _ = test_env
    bundle = _create_default_bundle(db, storage)
    identity = bundle.id
    prepared, artifact = bundle.prepared_musicxml_object, bundle.artifact_object
    prepared_id, artifact_id = prepared.id, artifact.id
    prepared_key, artifact_key = prepared.object_key, artifact.object_key
    upload = Upload(
        stored_object_id=prepared_id, original_filename="score.xml", uploader_user_id=user.id
    )
    db.add(upload)
    db.commit()
    due = practice_bundle_retention.retire_unowned(db, identity)
    db.commit()
    assert db.get(PracticeBundleRecord, identity) is None
    assert len(due) == 1
    operation = db.scalar(select(StoredObjectRetirement))
    assert operation.stored_object_id == artifact_id
    assert storage.exists(prepared_key) and storage.exists(artifact_key)
    assert drain_retirements(db, storage)[0]["status"] == "completed"
    assert storage.exists(prepared_key) and not storage.exists(artifact_key)
    db.delete(upload)
    assert len(retire_after_release(db, prepared_id)) == 1
    db.commit()
    assert drain_retirements(db, storage)[0]["status"] == "completed"
    assert db.get(StoredObject, prepared_id) is None


def test_bindings_protect_bundle_and_detached_take_lineage_does_not(test_env):
    db, storage, user, _ = test_env
    bundle = _create_default_bundle(db, storage, revision_id=100)
    identity = bundle.id
    take = _create_default_take(
        db,
        user_id=user.id,
        source=bundle,
        client_request_id="lineage",
        take_uuid="lineage",
        media_object_key="lineage.webm",
    )
    manifest_id = take.manifest_id
    db.commit()
    assert practice_bundle_retention.retire_unowned(db, identity) == []
    db.execute(delete(ScoreRevisionPracticeBinding))
    due = practice_bundle_retention.retire_unowned(db, identity)
    db.commit()
    assert len(due) == 2 and db.get(PracticeBundleRecord, identity) is None
    assert take.manifest_id == manifest_id
    assert all(result["status"] == "completed" for result in drain_retirements(db, storage))
    assert db.get(StoredObject, take.recording_object_id) is not None


def test_stale_creation_lease_has_no_physical_authority(test_env):
    db, storage, _, _ = test_env
    bundle = PracticeBundleRecord(
        bundle_id="creating",
        artifact_id="artifact",
        artifact_schema_version=1,
        status=PracticeBundleStatus.CREATING,
        creation_expires_at=utc_now() - timedelta(seconds=1),
    )
    db.add(bundle)
    db.commit()
    identity = bundle.id
    assert bundle.prepared_musicxml_object_id is None and bundle.artifact_object_id is None
    assert practice_bundle_retention.recover_stale_creating(db) == []
    db.commit()
    assert db.get(PracticeBundleRecord, identity) is None
    assert db.scalar(select(StoredObject)) is None


def test_ready_bundle_gc_has_its_own_bounded_batch(test_env, monkeypatch):
    db, storage, _, _ = test_env
    rows = [_create_default_bundle(db, storage, prepared_suffix=str(i).encode()) for i in range(3)]
    last_id = rows[-1].id
    db.commit()
    monkeypatch.setattr(settings, "PRACTICE_BUNDLE_GC_BATCH_SIZE", 2)
    assert len(practice_bundle_retention.collect_unowned_ready(db)) == 4
    db.commit()
    assert [row.id for row in db.scalars(select(PracticeBundleRecord))] == [last_id]
    assert len(practice_bundle_retention.collect_unowned_ready(db)) == 2


def test_creation_write_failure_queues_both_representations_without_binding(test_env):
    from app.core.exceptions import ValidationException

    db, storage, _, _ = test_env
    candidate = _canonical_bundle("score-uuid-10", "revision-uuid-100", "artifact")
    put = storage.put_bytes

    def fail_artifact(**kwargs):
        if kwargs["key"].endswith("artifact.json"):
            raise OSError("object store unavailable")
        return put(**kwargs)

    with patch.object(storage, "put_bytes", side_effect=fail_artifact):
        with pytest.raises(ValidationException) as error:
            bind_bundle(db, storage, candidate, revision_id=100)
    assert error.value.details["reason"] == "practice_bundle_storage_write_failed"
    assert db.scalar(select(PracticeBundleRecord)) is None
    assert db.get(ScoreRevisionPracticeBinding, 100) is None
    from app.db.models import ObjectWriteIntent
    from tests.support.write_cleanup import drain_write_cleanup

    assert db.scalar(select(StoredObject)) is None
    assert db.scalar(select(StoredObjectRetirement)) is None
    assert sorted(row.status for row in db.scalars(select(ObjectWriteIntent))) == [
        "CLEANUP_PENDING",
        "CLEANUP_PENDING",
    ]
    assert all(result["status"] == "cleaned" for result in drain_write_cleanup(db, storage))
