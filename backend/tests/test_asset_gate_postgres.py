"""Real PostgreSQL lock gates; physical byte fixtures do not qualify a Provider.

Synchronization observes actual pg_blocking_pids or explicit Events. No sleep,
retry or changed timeout policy is used to evade an application lock conflict.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from queue import Queue
from threading import Barrier, Event
from time import monotonic

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.composition.account_deletion import AccountDeletionExecutor
from app.composition.storage_resources import storage_quota_service as quota
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.core.security import get_password_hash
from app.db.models import (
    StorageQuotaHold,
    StorageUsageAccount,
    StorageUsageCategory as Category,
    StorageUsageCounter,
    User,
)
from app.modules.account.deletion_repository import AccountDeletionRepository
from app.modules.account.deletion_service import AccountDeletionService
from app.modules.account.resource_admission import lock_active_resource_user
from app.modules.storage_inventory.composition import build_storage_inventory_registry
from app.modules.storage_objects.writes import adopt_written_object, write_object
from app.modules.storage_usage.service import storage_usage_service as usage
from app.shared.time import utc_now
from tests.support.object_storage import InMemoryObjectStorage
from tests.support.storage_state import provision_storage_users


def wait_for_blocker(engine, blocker: int, contender: int) -> None:
    deadline = monotonic() + 10
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
        while not observer.scalar(
            text("SELECT :blocker = ANY(pg_blocking_pids(:contender))"),
            {"blocker": blocker, "contender": contender},
        ):
            assert monotonic() < deadline, "Expected PostgreSQL lock contention was not observed"


@pytest.fixture
def gate_database(postgres_engine):
    with Session(postgres_engine) as db:
        db.add(User(id=1, email="gate@example.com", password_hash=get_password_hash("secret123")))
        db.flush()
        provision_storage_users(db)
        db.commit()
    return postgres_engine


def test_account_fence_serializes_counter_first_allocation_with_object_first_adoption(
    gate_database,
):
    """Counter/Objects relative order is safe only inside the same User account fence.

    This tests actual accounting/adoption ports, not full business admission. Existing
    domain integration suites separately enforce semantic/Hold/Allocation atomicity.
    """
    engine = gate_database
    storage = InMemoryObjectStorage()
    with Session(engine) as db:
        receipt = write_object(
            db, storage, key="gate/object", content=b"bytes", content_type="text/plain"
        )
    ready = Queue()
    with Session(engine) as first, ThreadPoolExecutor(1) as pool:
        owner = first.scalar(text("SELECT pg_backend_pid()"))
        usage.committed_bytes(first, 1, lock=True)
        blob = adopt_written_object(first, receipt)

        def counter_then_adoption():
            with Session(engine) as second:
                ready.put(second.scalar(text("SELECT pg_backend_pid()")))
                usage.record_allocation(
                    second,
                    user_id=1,
                    category=Category.DERIVED_RENDER,
                    bytes_count=5,
                    reason="gate",
                )
                assert adopt_written_object(second, receipt).id == blob.id
                second.commit()

        contender = pool.submit(counter_then_adoption)
        try:
            wait_for_blocker(engine, owner, ready.get(timeout=10))
            usage.record_allocation(
                first, user_id=1, category=Category.DERIVED_RENDER, bytes_count=5, reason="gate"
            )
        finally:
            first.commit()
        contender.result(timeout=10)
    with Session(engine) as db:
        assert db.get(StorageUsageAccount, 1).used_bytes == 0
        assert (
            db.scalar(
                select(StorageUsageCounter.used_bytes).where(StorageUsageCounter.user_id == 1)
            )
            == 10
        )


def test_final_erasure_does_not_wait_backwards_on_hold_consumption(gate_database):
    engine = gate_database
    with Session(engine) as db:
        held = quota.create_hold(
            db,
            user_id=1,
            category=Category.UPLOAD,
            bytes_count=10,
            command_key="gate-hold",
            expires_at=utc_now() + timedelta(hours=1),
        )
        db.commit()
        AccountDeletionService().request_deletion(db, 1, current_password="secret123")
        db.commit()
    # A capacity participant with no business parent must not deadlock final
    # erasure's exclusive User lock through an accounting-event FK acquisition.
    with Session(engine) as accounting, ThreadPoolExecutor(1) as pool:
        assert quota.consume_hold(accounting, held.hold_id)

        def final_unit():
            with Session(engine) as erasing:
                result = AccountDeletionExecutor(build_storage_inventory_registry())._finalize(
                    erasing, 1
                )
                erasing.commit()
                return result

        assert pool.submit(final_unit).result(timeout=10) == "busy"
        assert accounting.get(StorageQuotaHold, held.hold_id).status.value == "CONSUMED"
        accounting.rollback()
    with Session(engine) as db:
        assert db.get(User, 1) is not None
        assert db.get(StorageQuotaHold, held.hold_id).status.value == "HELD"


def test_tombstone_commits_but_exclusive_erasure_waits_for_admitted_writer(gate_database):
    engine = gate_database
    ready = Queue()
    with Session(engine) as admitted, ThreadPoolExecutor(1) as pool:
        owner = admitted.scalar(text("SELECT pg_backend_pid()"))
        lock_active_resource_user(admitted, 1)
        with Session(engine) as closure:
            AccountDeletionService().request_deletion(closure, 1, current_password="secret123")
            closure.commit()
        with Session(engine) as late:
            with pytest.raises(ResourceNotFoundException):
                lock_active_resource_user(late, 1)

        def erase():
            with Session(engine) as db:
                ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                assert AccountDeletionRepository().lock_user(db, 1, erasure=True).deleted_at
                db.rollback()

        contender = pool.submit(erase)
        try:
            wait_for_blocker(engine, owner, ready.get(timeout=10))
        finally:
            admitted.rollback()
        contender.result(timeout=10)


def test_take_finalization_loses_to_reservation_expiry_after_physical_copy(
    postgres_bundle, monkeypatch
):
    from tests.test_upload_reservation_postgres import setup_bundle, MEDIA
    from tests.support.take_lifecycle import TakeLifecycleServices
    from app.modules.performance_takes.upload_reservation.cleanup import (
        upload_reservation_cleanup_service,
    )
    from app.modules.storage_usage.service import StorageUsageService
    from app.db.models import PerformanceTake
    from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
    from app.modules.performance_takes.upload_reservation.persistence import lifecycle_from_row

    sessions, source, storage, request = setup_bundle(postgres_bundle)
    service = TakeLifecycleServices(storage=storage, practice_bundle_service=source)
    with sessions() as db:
        reserved = service.reserve_upload(db, 1, request)
        row = service.repository.get_reservation_by_uuid(db, 1, reserved.reservation_id)
        storage.put_bytes(key=row.staging_object_key, content=MEDIA, content_type="audio/webm")
        future_time = row.expires_at + timedelta(hours=1)
        db.commit()
    entered, release = Event(), Event()
    original_verify = service.finalization.media.verify

    def held_verified_candidate(*args):
        candidate = original_verify(*args)
        entered.set()
        assert release.wait(10)
        return candidate

    monkeypatch.setattr(service.finalization.media, "verify", held_verified_candidate)

    def finalize():
        with sessions() as db:
            with pytest.raises(ValidationException):
                service.finalize_take(db, 1, reserved.reservation_id)

    with ThreadPoolExecutor(1) as pool:
        task = pool.submit(finalize)
        try:
            assert entered.wait(10)
            # Advance the lifecycle clock, not wall time or lease policy.
            monkeypatch.setattr(
                "app.modules.performance_takes.upload_reservation.cleanup.utc_now",
                lambda: future_time,
            )
            with sessions() as db:
                upload_reservation_cleanup_service.cleanup_expired_reservations(
                    db, storage, StorageUsageService()
                )
                row = service.repository.get_reservation_by_uuid(db, 1, reserved.reservation_id)
                assert lifecycle_from_row(row).status.value == "EXPIRED"
        finally:
            release.set()
        task.result(timeout=10)
    with sessions() as db:
        assert db.scalar(select(PerformanceTake)) is None
        assert db.scalar(select(PerformanceTakeUploadReservation)).status.value == "EXPIRED"
        assert db.get(StorageUsageAccount, 1).used_bytes == 0


pytest_plugins = ["tests.test_practice_bundle_postgres"]


@pytest.mark.parametrize("winner", [1, 2])
@pytest.mark.parametrize("deleted_user", [1, 2])
def test_two_upload_owners_share_canonical_object_without_cross_account_wait_cycle(
    gate_database, monkeypatch, winner, deleted_user
):
    """Real UploadService phases; only bytes and deterministic scheduling are fixtures.

    Both users hold their own capacity/account locks in semantic admission.
    The second waits on the shared write Intent held by the first adopter;
    that adopter can allocate and commit without waiting on the other User.
    Both winners and both deletion sides are exercised deterministically.
    """
    import hashlib
    import io

    from fastapi import UploadFile
    from starlette.datastructures import Headers

    from app.db.models import StoredObject, StoredObjectRetirement, StorageUsageEvent, Upload
    from app.modules.storage_objects.retirement import retire_after_release, retire_if_unreferenced
    from app.modules.uploads import service as upload_module
    from app.composition.storage_resources import provision_storage_resources
    from tests.support.images import image_bytes

    engine, storage = gate_database, InMemoryObjectStorage()
    content = image_bytes()
    key = upload_module.blob_object_key(hashlib.sha256(content).hexdigest(), ".png")
    with Session(engine) as db:
        db.add(
            User(id=2, email="gate-other@example.com", password_hash=get_password_hash("secret123"))
        )
        db.flush()
        # User 1 was provisioned by gate_database; provision only the new owner.
        provision_storage_resources(db, 2)
        db.commit()
        receipt = write_object(db, storage, key=key, content=content, content_type="image/png")
        blob_id = adopt_written_object(db, receipt).id
        retire_after_release(db, blob_id)
        db.commit()

    physical_phases_done = Barrier(2)
    holder_ready, release = Event(), Event()
    owner_pid, contender_pid = Queue(), Queue()
    original_write = upload_module.write_object
    original_adopt = upload_module.adopt_written_object

    def synchronized_write(db, *args, **kwargs):
        written = original_write(db, *args, **kwargs)
        physical_phases_done.wait(timeout=10)
        return written

    def observed_adopt(db, written):
        user_id = db.info["gate_user"]
        # Reentrant: the real Upload command already owns this Account and Hold.
        usage.committed_bytes(db, user_id, lock=True)
        if user_id == winner:
            result = original_adopt(db, written)
            owner_pid.put(db.scalar(text("SELECT pg_backend_pid()")))
            holder_ready.set()
            assert release.wait(10)
            return result
        assert holder_ready.wait(10)
        contender_pid.put(db.scalar(text("SELECT pg_backend_pid()")))
        return original_adopt(db, written)

    monkeypatch.setattr(upload_module, "write_object", synchronized_write)
    monkeypatch.setattr(upload_module, "adopt_written_object", observed_adopt)

    def create(user_id):
        with Session(engine) as db:
            db.info["gate_user"] = user_id
            return upload_module.UploadService(storage=storage).create_upload(
                db,
                db.get(User, user_id),
                UploadFile(
                    filename="shared.png",
                    file=io.BytesIO(content),
                    headers=Headers({"content-type": "image/png"}),
                ),
                client_request_id=f"cross-user-{user_id}",
            )

    with ThreadPoolExecutor(2) as pool:
        first, second = pool.submit(create, 1), pool.submit(create, 2)
        try:
            owner, contender = owner_pid.get(timeout=10), contender_pid.get(timeout=10)
            assert owner != contender
            wait_for_blocker(engine, owner, contender)
            with engine.connect() as observer:
                assert (
                    observer.scalar(
                        text("SELECT cardinality(pg_blocking_pids(:pid))"), {"pid": owner}
                    )
                    == 0
                )
        finally:
            release.set()
        results = first.result(timeout=10), second.result(timeout=10)

    with Session(engine) as db:
        assert len(list(db.scalars(select(StoredObject)))) == 1
        uploads = list(db.scalars(select(Upload).order_by(Upload.uploader_user_id)))
        assert len(uploads) == 2 and {u.stored_object_id for u in uploads} == {blob_id}
        assert {u.upload_uuid for u in uploads} == {r.upload_id for r in results}
        for user_id in (1, 2):
            assert db.get(StorageUsageAccount, user_id).used_bytes == len(content)
            assert db.scalar(
                select(StorageUsageCounter.used_bytes).where(
                    StorageUsageCounter.user_id == user_id,
                    StorageUsageCounter.category == Category.UPLOAD,
                )
            ) == len(content)
            assert (
                len(
                    list(
                        db.scalars(
                            select(StorageUsageEvent).where(StorageUsageEvent.user_id == user_id)
                        )
                    )
                )
                == 1
            )
            assert (
                db.scalar(
                    select(StorageQuotaHold).where(StorageQuotaHold.user_id == user_id)
                ).status.value
                == "CONSUMED"
            )
        retirement = db.scalar(select(StoredObjectRetirement))
        assert retirement.status.value == "CANCELLED" and retirement.deletion_fenced_at is None
        assert retire_if_unreferenced(db, blob_id) is None
        upload_module.UploadService(storage=storage).delete_upload(
            db, db.get(User, deleted_user), results[deleted_user - 1].upload_id
        )
        db.commit()
        assert db.get(StorageUsageAccount, deleted_user).used_bytes == 0
        survivor = 3 - deleted_user
        assert db.get(StorageUsageAccount, survivor).used_bytes == len(content)
        assert db.get(StoredObject, blob_id) is not None
        assert (
            db.scalar(select(Upload).where(Upload.uploader_user_id == survivor)).stored_object_id
            == blob_id
        )
        assert retire_if_unreferenced(db, blob_id) is None and storage.exists(key)
