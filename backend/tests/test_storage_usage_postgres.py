"""Accounting and semantic ownership follow the caller's PostgreSQL transaction."""

from tests.support.quota import admit_hold
from tests.support.quota import allocate_hold
from app.composition.storage_resources import storage_quota_service

import hashlib
import io
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi import UploadFile
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.exceptions import FileException, ValidationException
from tests.support.storage_state import provision_storage_users
from app.db.models import (
    ObjectWriteIntent,
    StoragePlanPolicy,
    StorageUsageAccount,
    StorageUsageCategory,
    StorageUsageCounter,
    StorageUsageEvent,
    StorageQuotaHold,
    StoredObject,
    Upload,
    User,
)
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.storage_usage.service import storage_usage_service as usage
from app.modules.uploads.service import UploadService, blob_object_key
from tests.support.images import image_bytes
from tests.support.write_cleanup import drain_write_cleanup
from tests.test_object_write_postgres import setup_worker
from tests.test_stored_object_retirement_postgres import retirement_postgres as retirement_postgres
from tests.test_stored_object_retirement_postgres import assert_blocked

pytest_plugins = ["tests.test_practice_bundle_postgres"]
OPERATIONS = [
    "hold",
    "consume",
    "release",
    "record_allocation",
    "record_release",
]


@pytest.fixture
def accounting(retirement_postgres):
    engine, _, _ = retirement_postgres
    with Session(engine) as db:
        db.add(StoragePlanPolicy(plan_code="FREE", default_limit_bytes=10000))
        db.flush()
        provision_storage_users(db)
        db.commit()
    return retirement_postgres


def ledger(engine):
    with Session(engine) as db:
        return (
            [
                (
                    row.used_bytes,
                    storage_quota_service.snapshot_user(db, row.user_id).reserved_bytes,
                )
                for row in db.scalars(select(StorageUsageAccount))
            ],
            db.execute(
                select(StorageUsageCounter.category, StorageUsageCounter.used_bytes).order_by(
                    StorageUsageCounter.category
                )
            ).all(),
            db.execute(
                select(StorageQuotaHold.id, StorageQuotaHold.status).order_by(StorageQuotaHold.id)
            ).all(),
            db.execute(
                select(StorageUsageEvent.id, StorageUsageEvent.delta_bytes).order_by(
                    StorageUsageEvent.id
                )
            ).all(),
            db.scalar(select(func.count()).select_from(Upload)),
            db.scalar(select(func.count()).select_from(StoredObject)),
        )


def seed_ledger(engine):
    with Session(engine) as db:
        usage.record_allocation(
            db, user_id=1, category=StorageUsageCategory.UPLOAD, bytes_count=8, reason="fixture"
        )
        handle = admit_hold(db, user_id=1, category=StorageUsageCategory.UPLOAD, bytes_count=4)
        db.commit()
        return handle.hold_id


def arguments(operation, reservation_id):
    if operation in {"consume", "release"}:
        return {"hold_id": reservation_id}
    return {
        "user_id": 1,
        "category": StorageUsageCategory.UPLOAD,
        "bytes_count": 3,
        **({} if operation == "hold" else {"reason": "caller"}),
    }


def add_owner(db):
    obj = object_from_bytes(
        object_key="transaction/owner.png", content=b"data", content_type="image/png"
    )
    db.add(
        Upload(
            upload_uuid="transaction-owner",
            stored_object=obj,
            original_filename="owner.png",
            uploader_user_id=1,
        )
    )


def test_concurrent_quota_holds_read_current_accounting_under_the_row_lock(accounting):
    engine, sessions, _ = accounting
    with sessions() as db:
        admit_hold(db, user_id=1, category=StorageUsageCategory.UPLOAD, bytes_count=4)
        db.get(StoragePlanPolicy, "FREE").default_limit_bytes = 10
        db.commit()
    ready = Event()
    pid = []

    def reserve():
        with sessions() as db:
            db.get(StorageUsageAccount, 1)
            assert storage_quota_service.snapshot_user(db, 1).reserved_bytes == 4
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            ready.set()
            with pytest.raises(ValidationException) as error:
                admit_hold(
                    db,
                    user_id=1,
                    category=StorageUsageCategory.UPLOAD,
                    bytes_count=4,
                )
            assert error.value.code == "storage_quota_exceeded"
            assert storage_quota_service.snapshot_user(db, 1).reserved_bytes == 8
            db.rollback()

    with ThreadPoolExecutor(max_workers=1) as pool, sessions() as first:
        admit_hold(first, user_id=1, category=StorageUsageCategory.UPLOAD, bytes_count=4)
        pending = pool.submit(reserve)
        try:
            assert ready.wait(10)
            assert_blocked(engine, pid[0])
            assert not pending.done()
        finally:
            first.commit()
        pending.result(10)
    with sessions() as observer:
        assert storage_quota_service.snapshot_user(observer, 1).reserved_bytes == 8
        assert observer.scalar(select(func.count()).select_from(StorageQuotaHold)) == 2


def test_release_observes_a_reservation_completed_by_another_transaction(accounting):
    engine, _, _ = accounting
    reservation_id = seed_ledger(engine)
    with Session(engine) as stale:
        reservation = stale.scalar(
            select(StorageQuotaHold).where(StorageQuotaHold.id == reservation_id)
        )
        assert reservation.status.value == "HELD"
        with Session(engine) as winner:
            allocate_hold(winner, reservation_id)
            winner.commit()
        committed = ledger(engine)
        storage_quota_service.release_hold(stale, reservation_id)
        assert reservation.status.value == "CONSUMED"
        stale.commit()
    assert ledger(engine) == committed


@pytest.mark.parametrize("operation", OPERATIONS)
def test_accounting_and_owner_mutations_follow_caller_commit(accounting, operation):
    engine, _, _ = accounting
    reservation_id = seed_ledger(engine)
    before = ledger(engine)
    with Session(engine) as db:
        if operation == "consume":
            add_owner(db)
        {
            "hold": admit_hold,
            "consume": allocate_hold,
            "release": storage_quota_service.release_hold,
            "record_allocation": usage.record_allocation,
            "record_release": usage.record_release,
        }[operation](db, **arguments(operation, reservation_id))
        assert ledger(engine) == before
        db.rollback()
    assert ledger(engine) == before
    with Session(engine) as db:
        if operation == "consume":
            add_owner(db)
        {
            "hold": admit_hold,
            "consume": allocate_hold,
            "release": storage_quota_service.release_hold,
            "record_allocation": usage.record_allocation,
            "record_release": usage.record_release,
        }[operation](db, **arguments(operation, reservation_id))
        db.commit()
    after = ledger(engine)
    assert after != before
    expected = {
        "hold": (8, 7),
        "consume": (12, 0),
        "release": (8, 0),
        "record_allocation": (11, 4),
        "record_release": (5, 4),
    }
    assert after[0] == [expected[operation]]
    if operation == "consume":
        with Session(engine) as db:
            assert db.scalar(select(Upload).where(Upload.upload_uuid == "transaction-owner"))
            assert db.get(StorageUsageAccount, 1).used_bytes == 12


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["success", "put_failure", "adoption_failure"])
async def test_upload_persists_its_hold_before_io_and_adopts_accounting_atomically(
    accounting, monkeypatch, outcome
):
    engine, sessions, storage = accounting
    content = image_bytes()
    key = blob_object_key(hashlib.sha256(content).hexdigest(), ".png")
    put = storage.put_bytes
    observations = []

    def physical_put(**kwargs):
        with Session(engine) as observer:
            account = observer.scalar(
                select(StorageUsageAccount)
                .where(StorageUsageAccount.user_id == 1)
                .with_for_update(nowait=True)
            )
            assert (
                storage_quota_service.snapshot_user(observer, 1).reserved_bytes == len(content)
                and account.used_bytes == 0
            )
            hold = observer.scalar(select(StorageQuotaHold))
            assert hold.status.value == "HELD"
            observations.append(hold.hold_uuid)
        result = put(**kwargs)
        if outcome == "put_failure":
            raise RuntimeError("provider acknowledgement unavailable")
        return result

    monkeypatch.setattr(storage, "put_bytes", physical_put)
    complete = storage_quota_service.consume_hold

    def reject_adoption(*args, **kwargs):
        complete(*args, **kwargs)
        raise RuntimeError("semantic admission unavailable")

    if outcome == "adoption_failure":
        monkeypatch.setattr(storage_quota_service, "consume_hold", reject_adoption)
    with sessions() as db:
        user = db.get(User, 1)

        def operation():
            return UploadService(storage=storage).create_upload(
                db, user, UploadFile(file=io.BytesIO(content), filename="score.png")
            )

        if outcome == "success":
            result = operation()
        else:
            with pytest.raises(FileException):
                operation()
    assert len(observations) == 1
    with Session(engine) as observer:
        account = observer.get(StorageUsageAccount, 1)
        hold = observer.scalar(select(StorageQuotaHold))
        intent = observer.scalar(
            select(ObjectWriteIntent).where(ObjectWriteIntent.object_key == key)
        )
        if outcome == "success":
            upload = observer.scalar(select(Upload).where(Upload.upload_uuid == result.upload_id))
            assert upload.stored_object.object_key == key
            assert (
                account.used_bytes == len(content)
                and storage_quota_service.snapshot_user(observer, 1).reserved_bytes == 0
            )
            assert hold.status.value == "CONSUMED" and intent.status == "ADOPTED"
        else:
            assert observer.scalar(select(Upload)) is None
            assert (
                observer.scalar(select(StoredObject).where(StoredObject.object_key == key)) is None
            )
            assert (
                account.used_bytes
                == storage_quota_service.snapshot_user(observer, 1).reserved_bytes
                == 0
            )
            assert hold.status.value == "RELEASED"
            assert intent.status == ("PREPARED" if outcome == "put_failure" else "WRITTEN")
    if outcome != "success":
        assert storage.exists(key)
        setup_worker(accounting, monkeypatch)
        with Session(engine) as db:
            assert all(row["status"] == "cleaned" for row in drain_write_cleanup(db, storage))
        assert not storage.exists(key)
