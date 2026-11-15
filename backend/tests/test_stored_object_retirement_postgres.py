"""Real PostgreSQL retirement/reference fences across independent connections."""

import asyncio
import io
from contextlib import contextmanager
from datetime import timedelta
from threading import Event

import pytest
from tests.support.images import image_bytes
import pytest_asyncio
from fastapi import UploadFile
from starlette.datastructures import Headers
from sqlalchemy import create_engine, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError

from app.db.models import (
    StoredObject,
    StoredObjectRetirement,
    Upload,
    User,
    StorageUsageAccount,
    StorageUsageCounter,
    StorageUsageCategory,
)
from app.modules.uploads.service import UploadService, blob_object_key
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.storage_objects.retirement import (
    retire_released_objects,
    retirement_delivery,
    delivery_lifecycle,
)
from app.worker.execution import stored_object_retirement as worker
from app.utils.timezone import utc_now_naive

pytest_plugins = ["tests.test_practice_bundle_postgres"]

CONTENT = image_bytes()


@pytest_asyncio.fixture
async def retirement_postgres(postgres_bundle, monkeypatch):
    engine, _, _, storage = postgres_bundle
    async with engine.connect() as connection:
        schema = await connection.scalar(text("SELECT current_schema()"))
    sync = create_engine(
        engine.url.set(drivername="postgresql+psycopg"),
        connect_args={"options": f"-csearch_path={schema}"},
    )

    @contextmanager
    def transaction():
        with Session(sync) as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    monkeypatch.setattr(worker, "get_worker_db", transaction)
    monkeypatch.setattr(worker, "object_storage", storage)
    yield engine, sync, async_sessionmaker(engine, expire_on_commit=False), storage
    sync.dispose()


async def assert_blocked(engine, pid):
    async with engine.connect() as observer:
        async with asyncio.timeout(10):
            while not await observer.scalar(
                text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
            ):
                await observer.commit()


async def seed(fixture, *, prior_owner=False, queued=True):
    import hashlib

    engine, sync, sessions, storage = fixture
    key = blob_object_key(hashlib.sha256(CONTENT).hexdigest(), ".png")
    storage.put_bytes(key=key, content=CONTENT, content_type="image/png")
    async with sessions() as db:
        obj = object_from_bytes(object_key=key, content=CONTENT, content_type="image/png")
        db.add(obj)
        await db.flush()
        identity = obj.id
        db.add(
            StorageUsageAccount(
                user_id=1,
                plan_code="FREE",
                quota_limit_bytes=1048576,
                used_bytes=len(CONTENT) if prior_owner else 0,
                reserved_bytes=0,
            )
        )
        db.add(
            StorageUsageCounter(
                user_id=1,
                category=StorageUsageCategory.UPLOAD,
                used_bytes=len(CONTENT) if prior_owner else 0,
                reserved_bytes=0,
            )
        )
        if prior_owner:
            upload = Upload(
                stored_object_id=identity, original_filename="initial.png", uploader_user_id=1
            )
            db.add(upload)
        await db.commit()
        if prior_owner:
            await UploadService(storage=storage).delete_upload(
                db, await db.get(User, 1), upload.upload_uuid
            )
        elif queued:
            await db.run_sync(lambda session: retire_released_objects(session, identity))
            await db.commit()
        operation = await db.scalar(select(StoredObjectRetirement))
        uuid = operation.retirement_uuid if operation is not None else None
    return identity, key, uuid


@pytest.mark.asyncio
@pytest.mark.parametrize("worker_wins", [False, True])
@pytest.mark.parametrize("prior_owner", [False, True])
async def test_retirement_vs_upload_reacquisition_after_last_reference_release(
    retirement_postgres, monkeypatch, worker_wins, prior_owner
):
    engine, sync, sessions, storage = retirement_postgres
    identity, key, uuid = await seed(retirement_postgres, prior_owner=prior_owner)
    entered, release = Event(), Event()
    delete = storage.delete
    lookup = worker._object

    def held_delete(key):
        entered.set()
        assert release.wait(15)
        return delete(key)

    def held_lookup(db, object_id):
        entered.set()
        assert release.wait(15)
        return lookup(db, object_id)

    monkeypatch.setattr(
        storage if worker_wins else worker,
        "delete" if worker_wins else "_object",
        held_delete if worker_wins else held_lookup,
    )
    deleting = asyncio.create_task(
        asyncio.to_thread(worker.execute_stored_object_retirement_task, None, uuid)
    )
    try:
        assert await asyncio.to_thread(entered.wait, 10)
        async with (
            engine.connect() as connection,
            AsyncSession(bind=connection, expire_on_commit=False) as db,
        ):
            pid = await db.scalar(text("SELECT pg_backend_pid()"))
            user = await db.get(User, 1)
            upload = asyncio.create_task(
                UploadService(storage=storage).create_upload(
                    db,
                    user,
                    UploadFile(
                        filename="again.png",
                        file=io.BytesIO(CONTENT),
                        headers=Headers({"content-type": "image/png"}),
                    ),
                )
            )
            if worker_wins:
                await assert_blocked(engine, pid)
                assert not upload.done()
                release.set()
            uploaded = await asyncio.wait_for(upload, 10)
            release.set()
        outcome = await asyncio.wait_for(deleting, 10)
        assert outcome["status"] == ("completed" if worker_wins else "ignored")
        async with sessions() as db:
            row = await db.scalar(select(Upload).where(Upload.upload_uuid == uploaded.upload_id))
            assert storage.read_bytes(row.stored_object.object_key) == CONTENT
            assert (row.stored_object_id != identity) is worker_wins
            operation = await db.scalar(
                select(StoredObjectRetirement).where(StoredObjectRetirement.retirement_uuid == uuid)
            )
            assert operation.status == ("COMPLETED" if worker_wins else "CANCELLED")
            assert (await db.get(StorageUsageAccount, 1)).used_bytes == len(CONTENT)
            assert storage.exists(key)
    finally:
        release.set()
        await deleting


@pytest.mark.asyncio
async def test_two_retirement_coordinators_serialize_to_one_operation(retirement_postgres):
    engine, sync, sessions, storage = retirement_postgres
    identity, key, _ = await seed(retirement_postgres, queued=False)
    async with (
        sessions() as first,
        engine.connect() as connection,
        AsyncSession(bind=connection) as second,
    ):
        one = await first.run_sync(lambda db: retire_released_objects(db, identity))
        pid = await second.scalar(text("SELECT pg_backend_pid()"))
        pending = asyncio.create_task(
            second.run_sync(lambda db: retire_released_objects(db, identity))
        )
        try:
            await assert_blocked(engine, pid)
            assert not pending.done()
        finally:
            await first.commit()
        assert await asyncio.wait_for(pending, 10) == one
        await second.commit()
    async with sessions() as db:
        assert len((await db.scalars(select(StoredObjectRetirement))).all()) == 1
        assert storage.exists(key)


@pytest.mark.asyncio
async def test_attempt_takeover_fences_stale_work_and_holds_rows_across_delete(
    retirement_postgres, monkeypatch
):
    engine, sync, sessions, storage = retirement_postgres
    identity, key, uuid = await seed(retirement_postgres)
    with Session(sync) as db:
        old = retirement_delivery.claim(db, uuid)
        db.commit()
        operation = retirement_delivery.get(db, uuid)
        operation.started_at = utc_now_naive() - timedelta(
            seconds=delivery_lifecycle().policy.processing_timeout_seconds
        )
        db.commit()
        assert retirement_delivery.recover_and_list_due(db) == [uuid]
        db.commit()
        current = retirement_delivery.claim(db, uuid)
        db.commit()
        assert current.attempt == old.attempt + 1
        assert not retirement_delivery.fail(db, old, "stale")
        db.commit()
        operation_id = retirement_delivery.get(db, uuid).id
    monkeypatch.setattr(retirement_delivery, "claim", lambda *_: old)
    assert (await asyncio.to_thread(worker.execute_stored_object_retirement_task, None, uuid))[
        "status"
    ] == "ignored"
    assert storage.exists(key)
    delete = storage.delete
    observations = []

    def locked_delete(key):
        for model, row_id in [(StoredObject, identity), (StoredObjectRetirement, operation_id)]:
            with Session(sync) as observer:
                with pytest.raises(OperationalError) as error:
                    observer.execute(
                        select(model).where(model.id == row_id).with_for_update(nowait=True)
                    )
                assert error.value.orig.sqlstate == "55P03"
                observations.append(model.__tablename__)
        return delete(key)

    monkeypatch.setattr(storage, "delete", locked_delete)
    monkeypatch.setattr(retirement_delivery, "claim", lambda *_: current)
    assert (await asyncio.to_thread(worker.execute_stored_object_retirement_task, None, uuid))[
        "status"
    ] == "completed"
    assert observations == ["stored_objects", "stored_object_retirements"]
    with Session(sync) as db:
        assert db.get(StoredObject, identity) is None
        assert retirement_delivery.get(db, uuid).status == "COMPLETED"
        assert not retirement_delivery.fail(db, old, "stale")
        db.commit()


@pytest.mark.asyncio
async def test_shared_take_release_keeps_lineage_and_accounts_before_physical_retirement(
    postgres_bundle, retirement_postgres, monkeypatch
):
    from tests.support.take_lifecycle import TakeLifecycleServices
    from app.modules.storage_usage.service import storage_usage_service
    from app.db.models import (
        PerformanceTake,
        PerformanceTakeManifest,
        PerformanceTakeUploadReservation,
    )
    from app.modules.performance_takes.manifest_persistence import manifest_from_row
    from app.modules.storage_objects.retirement import retain_for_reference
    from tests.test_upload_reservation_postgres import setup_bundle, MEDIA

    engine, sync, sessions, storage = retirement_postgres
    _, bundles, _, request = await setup_bundle(postgres_bundle)
    service = TakeLifecycleServices(storage=storage, practice_bundle_service=bundles)
    async with sessions() as db:
        accepted = await service.reserve_upload(db, 1, request)
        reservation = await service.repository.get_reservation_by_uuid(
            db, 1, accepted.reservation_id
        )
        storage.put_bytes(
            key=reservation.staging_object_key, content=MEDIA, content_type="audio/webm"
        )
        saved = await service.finalize_take(db, 1, accepted.reservation_id)
        take = await service.repository.get_by_uuid(db, 1, saved.take_id)
        identity, key, manifest_id = (
            take.recording_object_id,
            take.recording_object.object_key,
            take.manifest_id,
        )
        manifest = manifest_from_row(take.manifest)
        await db.run_sync(lambda session: retain_for_reference(session, identity))
        upload = Upload(
            stored_object_id=identity, original_filename="recording.webm", uploader_user_id=1
        )
        db.add(upload)
        await storage_usage_service.record_allocation(
            db,
            user_id=1,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=len(MEDIA),
            reason="test_shared_upload",
        )
        await db.commit()
        await service.takes.delete_take(db, 1, saved.take_id)
        assert await db.scalar(select(PerformanceTake)) is None
        assert await db.scalar(select(StoredObjectRetirement)) is None
        assert storage.exists(key)
        assert (await db.get(StorageUsageAccount, 1)).used_bytes == len(MEDIA)
        assert manifest_from_row(await db.get(PerformanceTakeManifest, manifest_id)) == manifest
        assert (await db.scalar(select(PerformanceTakeUploadReservation))).status == "COMPLETED"
        await UploadService(storage=storage).delete_upload(
            db, await db.get(User, 1), upload.upload_uuid
        )
        operation = await db.scalar(select(StoredObjectRetirement))
        uuid = operation.retirement_uuid
        assert operation.status == "PENDING" and storage.exists(key)
        assert (await db.get(StorageUsageAccount, 1)).used_bytes == 0
    delete = storage.delete
    monkeypatch.setattr(
        storage, "delete", lambda *_: (_ for _ in ()).throw(OSError("object service down"))
    )
    assert (await asyncio.to_thread(worker.execute_stored_object_retirement_task, None, uuid))[
        "status"
    ] == "failed"
    async with sessions() as db:
        operation = await db.scalar(select(StoredObjectRetirement))
        assert operation.status == "FAILED" and await db.get(StoredObject, identity) is not None
        assert await db.scalar(select(PerformanceTake)) is None
        assert (await db.get(StorageUsageAccount, 1)).used_bytes == 0
        assert manifest_from_row(await db.get(PerformanceTakeManifest, manifest_id)) == manifest
        operation.next_attempt_at = utc_now_naive()
        await db.commit()
    monkeypatch.setattr(storage, "delete", delete)
    assert (await asyncio.to_thread(worker.execute_stored_object_retirement_task, None, uuid))[
        "status"
    ] == "completed"
    async with sessions() as db:
        assert await db.get(StoredObject, identity) is None
        assert await db.get(PerformanceTakeManifest, manifest_id) is not None
        assert await db.scalar(select(PerformanceTakeUploadReservation)) is not None
