"""Async provider scheduling retains the real PostgreSQL generation fence."""

import asyncio
from datetime import timedelta
from threading import Event

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db.models import ObjectWriteIntent, StoredObject, Upload
from app.modules.storage_objects.writes import (
    adopt_written_object,
    write_object_async,
    write_cleanup_delivery,
    lock_intent,
)
from app.storage import AsyncObjectStorage
from app.utils.timezone import utc_now_naive
from tests.test_stored_object_retirement_postgres import (
    retirement_postgres as retirement_postgres,
    assert_blocked,
)
from tests.test_object_write_postgres import setup_worker
from app.worker.execution import object_write_cleanup as worker

pytest_plugins = ["tests.test_practice_bundle_postgres"]


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
async def test_async_physical_put_holds_generation_lock_until_settled(
    retirement_postgres, monkeypatch, cancel
):
    engine, sync, sessions, storage = setup_worker(retirement_postgres, monkeypatch)
    entered, release = Event(), Event()
    original = storage.put_bytes
    puts = []

    def put(**kwargs):
        puts.append(kwargs["key"])
        if len(puts) == 1:
            entered.set()
            assert release.wait(15)
        return original(**kwargs)

    monkeypatch.setattr(storage, "put_bytes", put)
    adapter = AsyncObjectStorage(storage)
    pid = []

    async def writing(second=False):
        async with sessions() as db:
            if second:
                pid.append(await db.scalar(text("SELECT pg_backend_pid()")))
            return await write_object_async(db, adapter, key="async/fenced", content=b"bytes")

    first = asyncio.create_task(writing())
    second = None
    try:
        assert await asyncio.to_thread(entered.wait, 10)
        async with sessions() as observer:
            row = await observer.scalar(select(ObjectWriteIntent))
            assert row.status == "PREPARED"
            assert await observer.scalar(select(StoredObject)) is None
        if cancel:
            first.cancel()
            await asyncio.sleep(0)
            assert not first.done()
        second = asyncio.create_task(writing(True))
        async with asyncio.timeout(10):
            while not pid:
                await asyncio.sleep(0)
        await assert_blocked(engine, pid[0])
        assert puts == ["async/fenced"]
        # Recovery skips the actively locked generation, even during provider IO.
        async with sessions() as recovery:
            assert await recovery.run_sync(write_cleanup_delivery.recover_and_list_due) == []
            await recovery.commit()
    finally:
        release.set()
        if cancel:
            with pytest.raises(asyncio.CancelledError):
                await first
        else:
            await first
    receipt = await second
    assert len(puts) == (2 if cancel else 1)
    async with sessions() as db:
        row = await db.scalar(select(ObjectWriteIntent))
        assert row.status == "WRITTEN" and row.write_token == receipt.write_token
        # Semantic rollback does not destroy cleanup evidence.
        obj = await db.run_sync(lambda sync: adopt_written_object(sync, receipt))
        db.add(Upload(stored_object_id=obj.id, original_filename="unused", uploader_user_id=1))
        await db.rollback()
        assert await db.scalar(select(StoredObject)) is None

    def expire():
        with Session(sync) as db:
            row = lock_intent(db, receipt.intent_uuid)
            row.write_expires_at = utc_now_naive() - timedelta(seconds=1)
            db.commit()
            write_cleanup_delivery.recover_and_list_due(db)
            db.commit()

    await asyncio.to_thread(expire)
    assert (
        await asyncio.to_thread(worker.execute_object_write_cleanup_task, None, receipt.intent_uuid)
    )["status"] == "cleaned"
    assert not storage.exists(receipt.object_key)
    async with sessions() as db:
        replacement = await write_object_async(
            db, adapter, key=receipt.object_key, content=b"bytes"
        )
        assert replacement.write_token != receipt.write_token
        with pytest.raises(ValueError, match="Stale"):
            await db.run_sync(lambda sync: adopt_written_object(sync, receipt))
        await db.rollback()
        obj = await db.run_sync(lambda sync: adopt_written_object(sync, replacement))
        db.add(Upload(stored_object_id=obj.id, original_filename="current", uploader_user_id=1))
        await db.commit()


@pytest.mark.asyncio
async def test_async_failed_put_retains_prepared_cleanup_evidence(retirement_postgres, monkeypatch):
    _, _, sessions, storage = retirement_postgres

    def fail(**kwargs):
        raise OSError("provider unavailable")

    monkeypatch.setattr(storage, "put_bytes", fail)
    async with sessions() as db:
        with pytest.raises(OSError):
            await write_object_async(
                db, AsyncObjectStorage(storage), key="async/failure", content=b"bytes"
            )
    async with sessions() as db:
        row = await db.scalar(select(ObjectWriteIntent))
        assert row.status == "PREPARED" and row.written_at is None
        assert await db.scalar(select(StoredObject)) is None


@pytest.mark.asyncio
async def test_async_existing_exact_object_reuses_without_provider_put(
    retirement_postgres, monkeypatch
):
    _, _, sessions, storage = retirement_postgres
    adapter = AsyncObjectStorage(storage)
    async with sessions() as db:
        receipt = await write_object_async(db, adapter, key="async/exact", content=b"bytes")
        obj = await db.run_sync(lambda sync: adopt_written_object(sync, receipt))
        db.add(Upload(stored_object_id=obj.id, original_filename="owner", uploader_user_id=1))
        await db.commit()

    def unexpected(**kwargs):
        pytest.fail("Committed exact object needs no physical rewrite")

    monkeypatch.setattr(storage, "put_bytes", unexpected)
    async with sessions() as db:
        duplicate = await write_object_async(db, adapter, key="async/exact", content=b"bytes")
        assert duplicate == receipt
