"""Real PostgreSQL lock gates; physical byte fixtures do not qualify a Provider.

Synchronization observes actual pg_blocking_pids or explicit Events. No sleep,
retry or changed timeout policy is used to evade an application lock conflict.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from queue import Queue
from threading import Event
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
