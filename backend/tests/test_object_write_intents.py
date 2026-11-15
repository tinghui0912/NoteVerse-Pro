"""Unadopted bytes retain durable ownership across write and adoption crash windows."""

from dataclasses import replace
from datetime import timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ObjectWriteIntent, StoredObject, Upload
from app.modules.storage_objects.facts import StoredObjectFacts
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.storage_objects.writes import (
    prepare_write,
    perform_write,
    write_object,
    adopt_written_object,
    write_cleanup_delivery,
    lock_intent,
)
from app.utils.timezone import utc_now_naive
from app.worker.execution import object_write_cleanup as worker
from tests.test_stored_object_retirement import retirement_db as retirement_db


def wire(fixture, monkeypatch):
    engine, storage, transaction = fixture
    monkeypatch.setattr(worker, "SessionLocal", transaction)
    monkeypatch.setattr(worker, "object_storage", storage)
    return engine, storage, transaction


def facts():
    return StoredObjectFacts.from_bytes(
        object_key="writes/immutable", content=b"bytes", content_type="application/octet-stream"
    )


def expire(transaction, uuid):
    with transaction() as db:
        row = lock_intent(db, uuid)
        row.write_expires_at = utc_now_naive() - timedelta(seconds=1)
    with transaction() as db:
        assert write_cleanup_delivery.recover_and_list_due(db) == [uuid]


def test_prepare_is_committed_before_put_and_returned_facts_are_verified(
    retirement_db, monkeypatch
):
    engine, storage, transaction = wire(retirement_db, monkeypatch)
    put = storage.put_bytes

    def writing(**kwargs):
        with Session(engine) as observer:
            row = observer.scalar(select(ObjectWriteIntent))
            assert row.status == "PREPARED" and row.write_token
            assert observer.scalar(select(StoredObject)) is None
        return put(**kwargs)

    monkeypatch.setattr(storage, "put_bytes", writing)
    with Session(engine) as db:
        receipt = write_object(db, storage, key=facts().object_key, content=b"bytes")
        assert lock_intent(db, receipt.intent_uuid).status == "WRITTEN"
        assert db.scalar(select(StoredObject)) is None
        obj = adopt_written_object(db, receipt)
        db.add(Upload(stored_object_id=obj.id, original_filename="upload.bin", uploader_user_id=1))
        identity = obj.id
        db.commit()
    with transaction() as db:
        assert lock_intent(db, receipt.intent_uuid).status == "ADOPTED"
        assert db.scalar(select(Upload)).stored_object_id == identity


@pytest.mark.parametrize(
    "phase", ["no_put", "put_before_written", "written_before_adoption", "adoption_rollback"]
)
def test_crash_windows_are_cleanup_owned(retirement_db, monkeypatch, phase):
    engine, storage, transaction = wire(retirement_db, monkeypatch)
    with Session(engine) as db:
        receipt = prepare_write(db, facts())
        if phase == "put_before_written":
            storage.put_bytes(key=receipt.object_key, content=b"bytes")
            db.rollback()  # process dies after IO, PREPARED remains committed
        elif phase in ("written_before_adoption", "adoption_rollback"):
            perform_write(db, storage, receipt, b"bytes")
            if phase == "adoption_rollback":
                obj = adopt_written_object(db, receipt)
                db.add(
                    Upload(stored_object_id=obj.id, original_filename="file", uploader_user_id=1)
                )
                db.flush()
                db.rollback()
        assert db.scalar(select(StoredObject)) is None
        assert db.scalar(select(Upload)) is None
    expire(transaction, receipt.intent_uuid)
    assert (
        worker.execute_object_write_cleanup_task(None, receipt.intent_uuid)["status"] == "cleaned"
    )
    with transaction() as db:
        assert lock_intent(db, receipt.intent_uuid).status == "CLEANED"
    assert not storage.exists(receipt.object_key)


def test_same_key_exact_reuse_conflict_and_generation_fence(retirement_db, monkeypatch):
    engine, storage, transaction = wire(retirement_db, monkeypatch)
    with Session(engine) as db:
        first = prepare_write(db, facts())
        assert prepare_write(db, facts()) == first
        with pytest.raises(ValueError, match="conflicting"):
            prepare_write(db, replace(facts(), sha256="f" * 64))
        db.rollback()
        with pytest.raises(ValueError, match="WRITTEN"):
            adopt_written_object(db, first)
        db.rollback()
    expire(transaction, first.intent_uuid)
    assert worker.execute_object_write_cleanup_task(None, first.intent_uuid)["status"] == "cleaned"
    with Session(engine) as db:
        current = prepare_write(db, facts())
        assert current.intent_uuid == first.intent_uuid and current.write_token != first.write_token
        with pytest.raises(ValueError, match="Stale"):
            perform_write(db, storage, first, b"bytes")
        db.rollback()
        assert lock_intent(db, current.intent_uuid).status == "PREPARED"


@pytest.mark.parametrize("conflict", [False, True])
def test_cleanup_obeys_committed_physical_authority(retirement_db, monkeypatch, conflict):
    engine, storage, transaction = wire(retirement_db, monkeypatch)
    with Session(engine) as db:
        receipt = write_object(db, storage, key=facts().object_key, content=b"bytes")
        obj = object_from_bytes(
            object_key=receipt.object_key,
            content=b"other" if conflict else b"bytes",
            content_type="application/octet-stream",
        )
        db.add(obj)
        db.commit()
    expire(transaction, receipt.intent_uuid)
    delete = Mock(wraps=storage.delete)
    monkeypatch.setattr(storage, "delete", delete)
    assert worker.execute_object_write_cleanup_task(None, receipt.intent_uuid)["status"] == (
        "failed" if conflict else "adopted"
    )
    assert delete.call_count == 0 and storage.exists(receipt.object_key)


def test_delete_failure_and_uncertain_completion_retry_idempotently(retirement_db, monkeypatch):
    engine, storage, transaction = wire(retirement_db, monkeypatch)
    with Session(engine) as db:
        receipt = write_object(db, storage, key=facts().object_key, content=b"bytes")
    expire(transaction, receipt.intent_uuid)
    delete = storage.delete
    monkeypatch.setattr(storage, "delete", Mock(side_effect=OSError("delete unavailable")))
    assert worker.execute_object_write_cleanup_task(None, receipt.intent_uuid)["status"] == "failed"
    with transaction() as db:
        row = lock_intent(db, receipt.intent_uuid)
        assert row.status == "CLEANUP_FAILED" and row.attempt_count == 1
        row.next_attempt_at = utc_now_naive()
    monkeypatch.setattr(storage, "delete", delete)
    commits = 0

    class UncertainSession(Session):
        def commit(self):
            nonlocal commits
            commits += 1
            if commits == 2:
                raise OSError("DB commit outcome uncertain")
            super().commit()

    def uncertain():
        return UncertainSession(engine)

    monkeypatch.setattr(worker, "SessionLocal", uncertain)
    assert worker.execute_object_write_cleanup_task(None, receipt.intent_uuid)["status"] == "failed"
    assert not storage.exists(receipt.object_key)
    monkeypatch.setattr(worker, "SessionLocal", transaction)
    with transaction() as db:
        lock_intent(db, receipt.intent_uuid).next_attempt_at = utc_now_naive()
    assert (
        worker.execute_object_write_cleanup_task(None, receipt.intent_uuid)["status"] == "cleaned"
    )


def test_existing_object_is_not_rewritten_and_adoption_rollback_does_not_cancel_retirement(
    retirement_db, monkeypatch
):
    from app.modules.storage_objects.retirement import retire_after_release, retirement_delivery

    engine, storage, transaction = wire(retirement_db, monkeypatch)
    with transaction() as db:
        obj = object_from_bytes(
            object_key=facts().object_key, content=b"bytes", content_type="application/octet-stream"
        )
        db.add(obj)
        db.flush()
        uuid = retire_after_release(db, obj.id)[0]
    put = Mock(wraps=storage.put_bytes)
    monkeypatch.setattr(storage, "put_bytes", put)
    with Session(engine) as db:
        receipt = write_object(db, storage, key=facts().object_key, content=b"bytes")
        assert retirement_delivery.get(db, uuid).status == "PENDING"
        adopt_written_object(db, receipt)
        assert retirement_delivery.get(db, uuid).status == "CANCELLED"
        db.rollback()
        assert retirement_delivery.get(db, uuid).status == "PENDING"
    assert put.call_count == 0


@pytest.mark.parametrize("mismatch", ["key", "size"])
def test_incorrect_storage_write_result_stays_prepared_and_cleanup_owned(
    retirement_db, monkeypatch, mismatch
):
    from app.storage.base import ObjectWriteResult

    engine, storage, transaction = wire(retirement_db, monkeypatch)
    put = storage.put_bytes

    def incorrect(**kwargs):
        result = put(**kwargs)
        return ObjectWriteResult(
            object_key="wrong" if mismatch == "key" else result.object_key,
            size_bytes=result.size_bytes + 1 if mismatch == "size" else result.size_bytes,
        )

    monkeypatch.setattr(storage, "put_bytes", incorrect)
    with Session(engine) as db:
        with pytest.raises(ValueError, match="result disagrees"):
            write_object(db, storage, key=facts().object_key, content=b"bytes")
        row = db.scalar(select(ObjectWriteIntent))
        uuid = row.intent_uuid
        assert row.status == "PREPARED" and db.scalar(select(StoredObject)) is None
    expire(transaction, uuid)
    assert worker.execute_object_write_cleanup_task(None, uuid)["status"] == "cleaned"


def test_cleanup_generation_takeover_rejects_stale_failure(retirement_db, monkeypatch):
    engine, storage, transaction = wire(retirement_db, monkeypatch)
    with Session(engine) as db:
        receipt = write_object(db, storage, key=facts().object_key, content=b"bytes")
    expire(transaction, receipt.intent_uuid)
    with transaction() as db:
        old = write_cleanup_delivery.claim(db, receipt.intent_uuid)
    with transaction() as db:
        row = lock_intent(db, receipt.intent_uuid)
        from app.modules.storage_objects.writes import cleanup_lifecycle

        row.started_at = utc_now_naive() - timedelta(
            seconds=cleanup_lifecycle().policy.processing_timeout_seconds
        )
    with transaction() as db:
        assert write_cleanup_delivery.recover_and_list_due(db) == [receipt.intent_uuid]
    with transaction() as db:
        current = write_cleanup_delivery.claim(db, receipt.intent_uuid)
        assert current.attempt == old.attempt + 1 and current.token != old.token
        write_cleanup_delivery.fail(db, old, "stale")
        assert lock_intent(db, receipt.intent_uuid).status == "CLEANUP_PROCESSING"
    monkeypatch.setattr(write_cleanup_delivery, "claim", lambda *_: old)
    assert (
        worker.execute_object_write_cleanup_task(None, receipt.intent_uuid)["status"] == "ignored"
    )
    assert storage.exists(receipt.object_key)
    monkeypatch.setattr(write_cleanup_delivery, "claim", lambda *_: current)
    assert (
        worker.execute_object_write_cleanup_task(None, receipt.intent_uuid)["status"] == "cleaned"
    )


def test_retired_existing_authority_cannot_be_recreated_by_an_unwritten_receipt(
    retirement_db, monkeypatch
):
    from app.modules.storage_objects.retirement import retire_after_release
    from app.worker.execution import stored_object_retirement

    engine, storage, transaction = wire(retirement_db, monkeypatch)
    with transaction() as db:
        obj = object_from_bytes(
            object_key=facts().object_key, content=b"bytes", content_type="application/octet-stream"
        )
        db.add(obj)
        db.flush()
        uuid = retire_after_release(db, obj.id)[0]
    storage.put_bytes(key=facts().object_key, content=b"bytes")
    with Session(engine) as db:
        receipt = write_object(db, storage, key=facts().object_key, content=b"bytes")
        assert lock_intent(db, receipt.intent_uuid).status == "ADOPTED"
        db.rollback()
    assert (
        stored_object_retirement.execute_stored_object_retirement_task(None, uuid)["status"]
        == "completed"
    )
    with Session(engine) as db:
        with pytest.raises(ValueError, match="WRITTEN"):
            adopt_written_object(db, receipt)
        db.rollback()
        assert db.scalar(select(StoredObject)) is None and not storage.exists(receipt.object_key)
        fresh = write_object(db, storage, key=receipt.object_key, content=b"bytes")
        assert fresh.write_token != receipt.write_token
        obj = adopt_written_object(db, fresh)
        db.add(Upload(stored_object_id=obj.id, original_filename="fresh", uploader_user_id=1))
        db.commit()
        assert storage.read_bytes(fresh.object_key) == b"bytes"


@pytest.mark.parametrize("broker_accepts", [False, True])
def test_cleanup_dispatch_rejection_preserves_attempt_and_durable_work(
    retirement_db, monkeypatch, broker_accepts
):
    from app.worker.dispatch import object_write_cleanup as dispatch
    from app.task_queue import producer

    engine, storage, transaction = wire(retirement_db, monkeypatch)
    with Session(engine) as db:
        receipt = write_object(db, storage, key=facts().object_key, content=b"bytes")
    expire(transaction, receipt.intent_uuid)
    monkeypatch.setattr(dispatch, "SessionLocal", transaction)

    def send(name, *, kwargs, task_id):
        assert name == "app.worker.tasks.object_write_cleanup_task"
        assert kwargs == {"intent_uuid": receipt.intent_uuid}
        with transaction() as db:
            row = lock_intent(db, receipt.intent_uuid)
            assert row.status == "CLEANUP_DISPATCHED" and row.attempt_count == 0
        if not broker_accepts:
            raise OSError("broker unavailable")

    monkeypatch.setattr(producer.celery_app, "send_task", send)
    assert dispatch.dispatch_object_write_cleanup(receipt.intent_uuid) is broker_accepts
    with transaction() as db:
        row = lock_intent(db, receipt.intent_uuid)
        assert row.status == ("CLEANUP_DISPATCHED" if broker_accepts else "CLEANUP_PENDING")
        assert row.attempt_count == 0
