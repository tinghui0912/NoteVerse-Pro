"""Physical mutations retain the PostgreSQL write-generation fence."""

from tests.support.runtime_resources import resources_for

from tests.support.uploads import settled_upload_session


import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import select

from app.db.models import ObjectWriteIntent, StoredObject, Upload
from app.modules.media_storage.adoption import adopt_written_object

from tests.test_stored_object_retirement_postgres import (
    retirement_postgres as retirement_postgres,
)
from tests.test_object_write_postgres import setup_worker
from tests.support.runtime_resources import deliveries

pytest_plugins = ["tests.test_practice_bundle_postgres"]


@pytest.mark.parametrize("interrupted", [False, True])
def test_unsettled_generation_excludes_parallel_write_without_retaining_database_lock(
    retirement_postgres, monkeypatch, interrupted
):
    engine, sessions, storage = setup_worker(retirement_postgres, monkeypatch)
    entered, release = Event(), Event()
    put = storage.put_bytes

    def held(**kwargs):
        entered.set()
        assert release.wait(10)
        result = put(**kwargs)
        if interrupted:
            raise asyncio.CancelledError()
        return result

    monkeypatch.setattr(storage, "put_bytes", held)
    coordinator = resources_for(storage).build_object_write_coordinator()
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(coordinator.write_bytes, key="generation/fenced", content=b"bytes")
        try:
            assert entered.wait(10)
            with sessions() as db:
                row = db.scalar(select(ObjectWriteIntent).with_for_update(nowait=True))
                assert row.status == "WRITING"
                assert deliveries().write_cleanup.recover_and_list_due(db) == []
                db.rollback()
            with pytest.raises(ValueError, match="owns"):
                pool.submit(
                    coordinator.write_bytes, key="generation/fenced", content=b"bytes"
                ).result(10)
        finally:
            release.set()
        if interrupted:
            with pytest.raises(asyncio.CancelledError):
                first.result(10)
            with sessions() as db:
                assert db.scalar(select(ObjectWriteIntent)).status == "WRITE_UNKNOWN"
        else:
            receipt = first.result(10)
            assert coordinator.write_bytes(key="generation/fenced", content=b"bytes") == receipt


def test_failed_put_retains_cleanup_evidence(retirement_postgres, monkeypatch):
    _, sessions, storage = retirement_postgres

    def fail(**kwargs):
        raise OSError("provider unavailable")

    monkeypatch.setattr(storage, "put_bytes", fail)
    with sessions() as db:
        with pytest.raises(OSError):
            resources_for(storage).build_object_write_coordinator().write_bytes(
                key="generation/failure", content=b"bytes"
            )
    with sessions() as db:
        row = db.scalar(select(ObjectWriteIntent))
        assert row.status == "WRITE_UNKNOWN" and row.written_at is None
        assert db.scalar(select(StoredObject)) is None


def test_existing_exact_object_reuses_without_provider_put(retirement_postgres, monkeypatch):
    _, sessions, storage = retirement_postgres
    adapter = storage
    with sessions() as db:
        receipt = (
            resources_for(adapter)
            .build_object_write_coordinator()
            .write_bytes(key="generation/exact", content=b"bytes")
        )
        obj = adopt_written_object(db, receipt)
        db.add(
            Upload(
                upload_session=settled_upload_session(user_id=1),
                stored_object_id=obj.id,
                original_filename="owner",
                uploader_user_id=1,
            )
        )
        db.commit()

    def unexpected(**kwargs):
        pytest.fail("Committed exact object needs no physical rewrite")

    monkeypatch.setattr(storage, "put_bytes", unexpected)
    with sessions() as db:
        duplicate = (
            resources_for(adapter)
            .build_object_write_coordinator()
            .write_bytes(key="generation/exact", content=b"bytes")
        )
        assert duplicate == receipt
