"""Real PostgreSQL retirement/reference fences across independent connections."""

from app.db.models.stored_object_retirement import StoredObjectRetirementStatus
from app.shared.performance_take_upload import UploadReservationStatus

from app.db.models import StoragePlanPolicy, UserStorageEntitlement

import asyncio
from concurrent.futures import ThreadPoolExecutor
from time import monotonic, sleep
import io
from datetime import timedelta
from threading import Event

import pytest
from tests.support.images import image_bytes
from fastapi import UploadFile
from starlette.datastructures import Headers
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker
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
    retire_after_release,
    retirement_delivery,
    delivery_lifecycle,
)
from app.worker.execution import stored_object_retirement as worker
from app.shared.time import utc_now

pytest_plugins = ["tests.test_practice_bundle_postgres"]

CONTENT = image_bytes()


@pytest.fixture
def retirement_postgres(postgres_bundle, monkeypatch):
    engine, _, _, storage = postgres_bundle
    with engine.connect() as connection:
        connection.scalar(text("SELECT current_schema()"))
    sessions = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(worker, "SessionLocal", sessions)
    monkeypatch.setattr(worker, "object_storage", storage)
    yield engine, sessions, storage


def assert_blocked(engine, pid):
    from time import monotonic, sleep

    deadline = monotonic() + 10
    with engine.connect() as observer:
        while not observer.scalar(
            text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
        ):
            observer.commit()
            assert monotonic() < deadline, "Expected PostgreSQL row-lock blocking"
            sleep(0.01)


def seed(fixture, *, prior_owner=False, queued=True):
    import hashlib

    engine, sessions, storage = fixture
    key = blob_object_key(hashlib.sha256(CONTENT).hexdigest(), ".png")
    storage.put_bytes(key=key, content=CONTENT, content_type="image/png")
    with sessions() as db:
        obj = object_from_bytes(object_key=key, content=CONTENT, content_type="image/png")
        db.add(obj)
        db.flush()
        identity = obj.id
        if db.get(StoragePlanPolicy, "FREE") is None:
            db.add(StoragePlanPolicy(plan_code="FREE", default_limit_bytes=1048576))
            db.flush()
        db.add(UserStorageEntitlement(user_id=1, plan_code="FREE"))
        db.add(
            StorageUsageAccount(
                user_id=1,
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
        db.commit()
        if prior_owner:
            UploadService(storage=storage).delete_upload(db, db.get(User, 1), upload.upload_uuid)
        elif queued:
            retire_after_release(db, identity)
            db.commit()
        operation = db.scalar(select(StoredObjectRetirement))
        uuid = operation.retirement_uuid if operation is not None else None
    return identity, key, uuid


@pytest.mark.parametrize("worker_wins", [False, True])
@pytest.mark.parametrize("prior_owner", [False, True])
def test_retirement_vs_upload_reacquisition_after_last_reference_release(
    retirement_postgres, monkeypatch, worker_wins, prior_owner
):
    engine, sessions, storage = retirement_postgres
    identity, key, uuid = seed(retirement_postgres, prior_owner=prior_owner)
    entered, release = Event(), Event()
    delete, lookup = storage.delete, worker._object

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
    pid = []

    def upload():
        with sessions() as db:
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            return UploadService(storage=storage).create_upload(
                db,
                db.get(User, 1),
                UploadFile(
                    filename="again.png",
                    file=io.BytesIO(CONTENT),
                    headers=Headers({"content-type": "image/png"}),
                ),
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        deleting = pool.submit(worker.execute_stored_object_retirement_task, None, uuid)
        try:
            assert entered.wait(10)
            uploading = pool.submit(upload)
            if worker_wins:
                deadline = monotonic() + 10
                while not pid:
                    assert monotonic() < deadline
                    sleep(0.01)
                assert_blocked(engine, pid[0])
                assert not uploading.done()
                release.set()
            uploaded = uploading.result(10)
            release.set()
            outcome = deleting.result(10)
        finally:
            release.set()
    assert outcome["status"] == ("completed" if worker_wins else "ignored")
    with sessions() as db:
        row = db.scalar(select(Upload).where(Upload.upload_uuid == uploaded.upload_id))
        assert storage.read_bytes(row.stored_object.object_key) == CONTENT
        assert (row.stored_object_id != identity) is worker_wins
        operation = db.scalar(
            select(StoredObjectRetirement).where(StoredObjectRetirement.retirement_uuid == uuid)
        )
        assert operation.status is (
            StoredObjectRetirementStatus.COMPLETED
            if worker_wins
            else StoredObjectRetirementStatus.CANCELLED
        )
        assert db.get(StorageUsageAccount, 1).used_bytes == len(CONTENT)
        assert storage.exists(key)


def test_two_retirement_coordinators_serialize_to_one_operation(retirement_postgres):
    engine, sessions, storage = retirement_postgres
    identity, key, _ = seed(retirement_postgres, queued=False)
    pid = []

    def coordinate():
        with sessions() as db:
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            outcome = retire_after_release(db, identity)
            db.commit()
            return outcome

    with ThreadPoolExecutor(max_workers=1) as pool, sessions() as first:
        one = retire_after_release(first, identity)
        pending = pool.submit(coordinate)
        try:
            deadline = monotonic() + 10
            while not pid:
                assert monotonic() < deadline
                sleep(0.01)
            assert_blocked(engine, pid[0])
            assert not pending.done()
        finally:
            first.commit()
        assert pending.result(10) == one
    with sessions() as db:
        assert len(list(db.scalars(select(StoredObjectRetirement)))) == 1
        assert storage.exists(key)


@pytest.mark.asyncio
async def test_attempt_takeover_fences_stale_work_and_holds_rows_across_delete(
    retirement_postgres, monkeypatch
):
    engine, sessions, storage = retirement_postgres
    identity, key, uuid = seed(retirement_postgres)
    with Session(engine) as db:
        old = retirement_delivery.claim(db, uuid)
        db.commit()
        operation = retirement_delivery.get(db, uuid)
        operation.started_at = utc_now() - timedelta(
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
            with Session(engine) as observer:
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
    with Session(engine) as db:
        assert db.get(StoredObject, identity) is None
        assert retirement_delivery.get(db, uuid).status is StoredObjectRetirementStatus.COMPLETED
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

    engine, sessions, storage = retirement_postgres
    _, bundles, _, request = setup_bundle(postgres_bundle)
    service = TakeLifecycleServices(storage=storage, practice_bundle_service=bundles)
    with sessions() as db:
        accepted = service.reserve_upload(db, 1, request)
        reservation = service.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        storage.put_bytes(
            key=reservation.staging_object_key, content=MEDIA, content_type="audio/webm"
        )
        saved = service.finalize_take(db, 1, accepted.reservation_id)
        take = service.repository.get_by_uuid(db, 1, saved.take_id)
        identity, key, manifest_id = (
            take.recording_object_id,
            take.recording_object.object_key,
            take.manifest_id,
        )
        manifest = manifest_from_row(take.manifest)
        retain_for_reference(db, identity)
        upload = Upload(
            stored_object_id=identity, original_filename="recording.webm", uploader_user_id=1
        )
        db.add(upload)
        storage_usage_service.record_allocation(
            db,
            user_id=1,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=len(MEDIA),
            reason="test_shared_upload",
        )
        db.commit()
        service.takes.delete_take(db, 1, saved.take_id)
        assert db.scalar(select(PerformanceTake)) is None
        assert db.scalar(select(StoredObjectRetirement)) is None
        assert storage.exists(key)
        assert (db.get(StorageUsageAccount, 1)).used_bytes == len(MEDIA)
        assert manifest_from_row(db.get(PerformanceTakeManifest, manifest_id)) == manifest
        reservation = db.scalar(select(PerformanceTakeUploadReservation))
        assert reservation is not None
        assert reservation.status is UploadReservationStatus.COMPLETED
        UploadService(storage=storage).delete_upload(db, db.get(User, 1), upload.upload_uuid)
        operation = db.scalar(select(StoredObjectRetirement))
        uuid = operation.retirement_uuid
        assert operation.status is StoredObjectRetirementStatus.PENDING and storage.exists(key)
        assert (db.get(StorageUsageAccount, 1)).used_bytes == 0
    delete = storage.delete
    monkeypatch.setattr(
        storage, "delete", lambda *_: (_ for _ in ()).throw(OSError("object service down"))
    )
    assert (await asyncio.to_thread(worker.execute_stored_object_retirement_task, None, uuid))[
        "status"
    ] == "failed"
    with sessions() as db:
        operation = db.scalar(select(StoredObjectRetirement))
        assert (
            operation.status is StoredObjectRetirementStatus.FAILED
            and db.get(StoredObject, identity) is not None
        )
        assert db.scalar(select(PerformanceTake)) is None
        assert (db.get(StorageUsageAccount, 1)).used_bytes == 0
        assert manifest_from_row(db.get(PerformanceTakeManifest, manifest_id)) == manifest
        operation.next_attempt_at = utc_now()
        db.commit()
    monkeypatch.setattr(storage, "delete", delete)
    assert (await asyncio.to_thread(worker.execute_stored_object_retirement_task, None, uuid))[
        "status"
    ] == "completed"
    with sessions() as db:
        assert db.get(StoredObject, identity) is None
        assert db.get(PerformanceTakeManifest, manifest_id) is not None
        assert db.scalar(select(PerformanceTakeUploadReservation)) is not None
