"""Real foreign-key ownership and durable retirement behavior without a broker."""

from app.modules.media_storage.domain import StoredObjectRetirementStatus

from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy import UniqueConstraint, event, select
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.db.models import StoredObject, StoredObjectRetirement, Upload, User
from app.modules.media_storage.persistence import object_from_bytes
from app.modules.media_storage.references import SEMANTIC_REFERENCES
from app.modules.media_storage.retirement import (
    retire_after_release,
    retain_for_reference,
    retirement_delivery,
    delivery_lifecycle,
)
from app.worker.execution import stored_object_retirement as worker
from app.modules.media_storage import retirement_execution
from app.shared.time import utc_now
from tests.support.object_storage import InMemoryObjectStorage


@pytest.fixture
def retirement_db(postgres_engine, monkeypatch):
    engine = postgres_engine

    SQLModel.metadata.create_all(engine)
    storage = InMemoryObjectStorage()
    with Session(engine) as db:
        db.add(
            User(id=1, email="retirement@example.com", display_name="Owner", password_hash="test")
        )
        db.commit()

    @contextmanager
    def transaction():
        with Session(engine) as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    monkeypatch.setattr(worker, "SessionLocal", transaction)
    monkeypatch.setattr(worker, "object_storage", storage)
    yield engine, storage, transaction
    engine.dispose()


def unowned(fixture):
    engine, storage, transaction = fixture
    storage.put_bytes(
        key="immutable/object", content=b"bytes", content_type="application/octet-stream"
    )
    with transaction() as db:
        obj = object_from_bytes(
            object_key="immutable/object", content=b"bytes", content_type="application/octet-stream"
        )
        db.add(obj)
        db.flush()
        identity = obj.id
        uuid = retire_after_release(db, identity)[0]
    return identity, uuid


def test_two_different_semantic_owners_release_independently(retirement_db):
    engine, storage, transaction = retirement_db
    with transaction() as db:
        obj = object_from_bytes(object_key="shared", content=b"shared", content_type="image/jpeg")
        db.add(obj)
        db.flush()
        identity = obj.id
        upload = Upload(
            stored_object_id=identity, original_filename="photo.jpg", uploader_user_id=1
        )
        db.add(upload)
        user = db.get(User, 1)
        user.avatar_object_id = identity
        db.flush()
        db.delete(upload)
        assert retire_after_release(db, identity) == []
        assert db.get(StoredObject, identity) is obj
        assert db.scalar(select(StoredObjectRetirement)) is None
        user.avatar_object_id = None
        uuid = retire_after_release(db, identity)[0]
        assert retire_after_release(db, identity) == [uuid]
        assert len(db.scalars(select(StoredObjectRetirement)).all()) == 1


@pytest.mark.parametrize("physical_missing", [False, True])
def test_fk_flush_precedes_physical_delete_and_completion(
    retirement_db, monkeypatch, physical_missing
):
    engine, storage, transaction = retirement_db
    identity, uuid = unowned(retirement_db)
    events = []

    @event.listens_for(engine, "before_cursor_execute")
    def deleting(_connection, _cursor, statement, *_args):
        if statement.startswith("DELETE FROM stored_objects"):
            events.append("flush")

    delete = storage.delete
    if physical_missing:
        delete("immutable/object")

    def physical(key):
        events.append("physical")
        assert events == ["flush", "physical"]
        return delete(key)

    monkeypatch.setattr(storage, "delete", physical)
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "completed"
    with transaction() as db:
        assert db.get(StoredObject, identity) is None
        operation = retirement_delivery.get(db, uuid)
        assert (
            operation.status is StoredObjectRetirementStatus.COMPLETED
            and operation.stored_object_id is None
        )
        assert operation.completed_at is not None and operation.failure_detail is None
    assert not storage.exists("immutable/object")


def test_reacquisition_cancels_and_last_release_rearms(retirement_db):
    engine, storage, transaction = retirement_db
    identity, uuid = unowned(retirement_db)
    with transaction() as db:
        obj = retain_for_reference(db, identity)
        db.add(Upload(stored_object_id=obj.id, original_filename="again.png", uploader_user_id=1))
    with transaction() as db:
        assert retirement_delivery.get(db, uuid).status is StoredObjectRetirementStatus.CANCELLED
        upload = db.scalar(select(Upload))
        db.delete(upload)
        assert retire_after_release(db, identity) == [uuid]
        operation = retirement_delivery.get(db, uuid)
        assert (
            operation.status is StoredObjectRetirementStatus.PENDING
            and operation.attempt_count == 0
        )


def test_worker_cancels_if_reference_appears_before_destruction(retirement_db, monkeypatch):
    engine, storage, transaction = retirement_db
    identity, uuid = unowned(retirement_db)
    with transaction() as db:
        db.add(Upload(stored_object_id=identity, original_filename="live.png", uploader_user_id=1))
    delete = Mock(wraps=storage.delete)
    monkeypatch.setattr(storage, "delete", delete)
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "cancelled"
    assert delete.call_count == 0 and storage.exists("immutable/object")
    with transaction() as db:
        assert retirement_delivery.get(db, uuid).status is StoredObjectRetirementStatus.CANCELLED
        assert db.get(StoredObject, identity) is not None


@pytest.mark.parametrize("failure", ["storage", "snapshot", "missing", "foreign_key"])
def test_failures_do_not_retire_live_or_unverified_bytes(retirement_db, monkeypatch, failure):
    engine, storage, transaction = retirement_db
    identity, uuid = unowned(retirement_db)
    with transaction() as db:
        if failure == "snapshot":
            retirement_delivery.get(db, uuid).sha256 = "f" * 64
        elif failure == "missing":
            db.delete(db.get(StoredObject, identity))
        elif failure == "foreign_key":
            db.add(
                Upload(
                    stored_object_id=identity, original_filename="protected.png", uploader_user_id=1
                )
            )
    delete = (
        Mock(side_effect=OSError("storage unavailable"))
        if failure == "storage"
        else Mock(wraps=storage.delete)
    )
    monkeypatch.setattr(storage, "delete", delete)
    if failure == "foreign_key":
        monkeypatch.setattr(
            retirement_execution, "stored_object_has_semantic_references", lambda *_: False
        )
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "failed"
    assert delete.call_count == (1 if failure == "storage" else 0)
    assert storage.exists("immutable/object")
    with transaction() as db:
        operation = retirement_delivery.get(db, uuid)
        assert (
            operation.status is StoredObjectRetirementStatus.FAILED and operation.attempt_count == 1
        )
        assert operation.next_attempt_at > operation.started_at
        if failure != "missing":
            assert db.get(StoredObject, identity) is not None


def test_cancel_rearm_does_not_allow_stale_attempt_aba(retirement_db, monkeypatch):
    engine, storage, transaction = retirement_db
    identity, uuid = unowned(retirement_db)
    with transaction() as db:
        old = retirement_delivery.claim(db, uuid)
    with transaction() as db:
        retain_for_reference(db, identity)
        retire_after_release(db, identity)
        current = retirement_delivery.claim(db, uuid)
        assert current.attempt == old.attempt and current.token != old.token
        assert not retirement_delivery.fail(db, old, "stale")
    monkeypatch.setattr(retirement_delivery, "claim", lambda *_: old)
    delete = Mock(wraps=storage.delete)
    monkeypatch.setattr(storage, "delete", delete)
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "ignored"
    assert delete.call_count == 0
    with transaction() as db:
        assert retirement_delivery.get(db, uuid).attempt_token == current.token


@pytest.mark.parametrize(
    "status,field,timeout",
    [
        (StoredObjectRetirementStatus.DISPATCHED, "dispatched_at", "dispatch_timeout_seconds"),
        (StoredObjectRetirementStatus.PROCESSING, "started_at", "processing_timeout_seconds"),
    ],
)
def test_exact_lease_cutoff_is_immediately_due_without_consuming_attempt(
    retirement_db, monkeypatch, status, field, timeout
):
    engine, storage, transaction = retirement_db
    identity, uuid = unowned(retirement_db)
    now = utc_now()
    with transaction() as db:
        operation = retirement_delivery.get(db, uuid)
        operation.status = status
        operation.attempt_token = (
            "fixture-token" if status == StoredObjectRetirementStatus.PROCESSING else None
        )
        operation.attempt_count = 2
        setattr(
            operation, field, now - timedelta(seconds=getattr(delivery_lifecycle().policy, timeout))
        )
    monkeypatch.setattr("app.modules.media_storage.retirement.utc_now", lambda: now)
    with transaction() as db:
        assert retirement_delivery.recover_and_list_due(db) == [uuid]
        operation = retirement_delivery.get(db, uuid)
        assert (
            operation.status is StoredObjectRetirementStatus.FAILED
            and operation.next_attempt_at == now
        )
        assert operation.attempt_count == 2


def test_reference_registry_classifies_every_real_foreign_key():
    semantic = {(column.table.name, column.name) for column in SEMANTIC_REFERENCES}
    actual = set()
    operations = set()
    for table in SQLModel.metadata.tables.values():
        for fk in table.foreign_keys:
            if fk.target_fullname == "stored_objects.id":
                identity = (table.name, fk.parent.name)
                if table.name == "stored_object_retirements":
                    assert fk.ondelete == "SET NULL"
                    operations.add(identity)
                else:
                    assert fk.ondelete == "RESTRICT"
                    actual.add(identity)
    assert actual == semantic and len(semantic) == 9
    assert operations == {("stored_object_retirements", "stored_object_id")}


def test_every_semantic_reference_has_a_leading_column_lookup_path():
    for column in SEMANTIC_REFERENCES:
        unique = any(
            isinstance(constraint, UniqueConstraint)
            and tuple(constraint.columns.keys()) == (column.name,)
            for constraint in column.table.constraints
        )
        indexed = any(
            index.expressions[0] is column
            and index.dialect_options["postgresql"].get("where") is None
            for index in column.table.indexes
        )
        assert unique or indexed, f"{column.table.name}.{column.name} needs a leading-column index"


@pytest.mark.parametrize("broker_accepts", [False, True])
def test_dispatch_commits_before_publish_and_rejection_releases_without_attempt(
    retirement_db, monkeypatch, broker_accepts
):
    from app.worker.dispatch import stored_object_retirement as dispatch
    from app.task_queue import producer

    engine, storage, transaction = retirement_db
    identity, uuid = unowned(retirement_db)
    monkeypatch.setattr(dispatch, "SessionLocal", transaction)

    def publish(name, *, kwargs, task_id):
        assert name == "app.worker.tasks.stored_object_retirement_task"
        assert kwargs == {"retirement_uuid": uuid} and task_id
        with transaction() as db:
            operation = retirement_delivery.get(db, uuid)
            assert (
                operation.status is StoredObjectRetirementStatus.DISPATCHED
                and operation.attempt_count == 0
            )
        if not broker_accepts:
            raise OSError("broker rejected")

    monkeypatch.setattr(producer.celery_app, "send_task", publish)
    assert dispatch.dispatch_stored_object_retirement(uuid) is broker_accepts
    with transaction() as db:
        operation = retirement_delivery.get(db, uuid)
        assert operation.status is (
            StoredObjectRetirementStatus.DISPATCHED
            if broker_accepts
            else StoredObjectRetirementStatus.PENDING
        )
        assert operation.attempt_count == 0
        if broker_accepts:
            assert operation.failure_detail is None
        else:
            assert operation.failure_code == "stored_object_retirement_dispatch_failed"
            assert operation.failure_classification == "transient"
            assert operation.failure_retryable is True
            assert "broker rejected" not in operation.failure_detail
        if not broker_accepts:
            assert operation.dispatched_at is None
