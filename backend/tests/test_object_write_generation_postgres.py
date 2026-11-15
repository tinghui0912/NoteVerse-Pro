"""Physical mutations retain the PostgreSQL write-generation fence."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from time import monotonic, sleep
from datetime import timedelta
from threading import Event

import pytest
from sqlalchemy import select, text

from app.db.models import ObjectWriteIntent, StoredObject, Upload
from app.modules.storage_objects.writes import (
    adopt_written_object,
    write_object,
    write_cleanup_delivery,
    lock_intent,
)
from app.utils.timezone import utc_now_naive
from tests.test_stored_object_retirement_postgres import (
    retirement_postgres as retirement_postgres,
    assert_blocked,
)
from tests.test_object_write_postgres import setup_worker
from app.worker.execution import object_write_cleanup as worker

pytest_plugins = ["tests.test_practice_bundle_postgres"]


@pytest.mark.parametrize("interrupted", [False, True])
def test_physical_put_holds_generation_lock_until_settled(
    retirement_postgres, monkeypatch, interrupted
):
    engine, sessions, storage = setup_worker(retirement_postgres, monkeypatch)
    entered, release = Event(), Event()
    original = storage.put_bytes
    puts, pid = [], []

    def put(**kwargs):
        puts.append(kwargs["key"])
        if len(puts) == 1:
            entered.set()
            assert release.wait(15)
            result = original(**kwargs)
            if interrupted:
                raise asyncio.CancelledError()
            return result
        return original(**kwargs)

    monkeypatch.setattr(storage, "put_bytes", put)

    def write(second=False):
        with sessions() as db:
            if second:
                pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            return write_object(db, storage, key="generation/fenced", content=b"bytes")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(write)
        try:
            assert entered.wait(10)
            with sessions() as observer:
                row = observer.scalar(select(ObjectWriteIntent))
                assert row.status == "PREPARED"
                assert observer.scalar(select(StoredObject)) is None
            second = pool.submit(write, True)
            deadline = monotonic() + 10
            while not pid:
                assert monotonic() < deadline
                sleep(0.01)
            assert_blocked(engine, pid[0])
            assert puts == ["generation/fenced"]
            with sessions() as recovery:
                assert write_cleanup_delivery.recover_and_list_due(recovery) == []
                recovery.commit()
        finally:
            release.set()
        if interrupted:
            with pytest.raises(asyncio.CancelledError):
                first.result(10)
        else:
            first.result(10)
        receipt = second.result(10)
    assert len(puts) == (2 if interrupted else 1)
    with sessions() as db:
        row = db.scalar(select(ObjectWriteIntent))
        assert row.status == "WRITTEN" and row.write_token == receipt.write_token
        obj = adopt_written_object(db, receipt)
        db.add(Upload(stored_object_id=obj.id, original_filename="unused", uploader_user_id=1))
        db.rollback()
        assert db.scalar(select(StoredObject)) is None
        row = lock_intent(db, receipt.intent_uuid)
        row.write_expires_at = utc_now_naive() - timedelta(seconds=1)
        db.commit()
        write_cleanup_delivery.recover_and_list_due(db)
        db.commit()
    assert (
        worker.execute_object_write_cleanup_task(None, receipt.intent_uuid)["status"] == "cleaned"
    )
    assert not storage.exists(receipt.object_key)
    with sessions() as db:
        replacement = write_object(db, storage, key=receipt.object_key, content=b"bytes")
        assert replacement.write_token != receipt.write_token
        with pytest.raises(ValueError, match="Stale"):
            adopt_written_object(db, receipt)
        db.rollback()
        obj = adopt_written_object(db, replacement)
        db.add(Upload(stored_object_id=obj.id, original_filename="current", uploader_user_id=1))
        db.commit()


def test_failed_put_retains_prepared_cleanup_evidence(retirement_postgres, monkeypatch):
    _, sessions, storage = retirement_postgres

    def fail(**kwargs):
        raise OSError("provider unavailable")

    monkeypatch.setattr(storage, "put_bytes", fail)
    with sessions() as db:
        with pytest.raises(OSError):
            write_object(db, storage, key="generation/failure", content=b"bytes")
    with sessions() as db:
        row = db.scalar(select(ObjectWriteIntent))
        assert row.status == "PREPARED" and row.written_at is None
        assert db.scalar(select(StoredObject)) is None


def test_existing_exact_object_reuses_without_provider_put(retirement_postgres, monkeypatch):
    _, sessions, storage = retirement_postgres
    adapter = storage
    with sessions() as db:
        receipt = write_object(db, adapter, key="generation/exact", content=b"bytes")
        obj = adopt_written_object(db, receipt)
        db.add(Upload(stored_object_id=obj.id, original_filename="owner", uploader_user_id=1))
        db.commit()

    def unexpected(**kwargs):
        pytest.fail("Committed exact object needs no physical rewrite")

    monkeypatch.setattr(storage, "put_bytes", unexpected)
    with sessions() as db:
        duplicate = write_object(db, adapter, key="generation/exact", content=b"bytes")
        assert duplicate == receipt
