"""Quota authorities, capacity races and caller-owned allocation transactions."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4
import pytest
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.api.deps import get_current_user, get_db
from app.main import app
from app.core.exceptions import ConflictException, ValidationException
from app.composition.storage_resources import read_storage_usage
from app.composition.storage_resources import storage_quota_service as quota, storage_quota_expiry
from app.db.models import (
    User,
    StoragePlanPolicy,
    UserStorageEntitlement,
    StorageQuotaHold,
    StorageUsageAccount,
    StorageUsageEvent,
)
from app.modules.storage_governance.quota.states import StorageQuotaHoldStatus as Status
from app.modules.storage_governance.quota.states import StoragePlanCode as Plan
from app.modules.storage_governance.usage.domain import StorageUsageCategory as Category
from app.composition.storage_resources import storage_usage_service as usage
from app.modules.storage_governance.quota.domain import hold_transition
from app.shared.time import utc_now
from tests.support.storage_state import provision_storage_users


@pytest.fixture
def database(postgres_engine):
    with Session(postgres_engine) as db:
        db.add_all(
            [User(id=n, email=f"quota{n}@example.test", password_hash="hash") for n in (1, 2)]
        )
        db.flush()
        provision_storage_users(db, default_limit_bytes=100)
        db.commit()
    return postgres_engine


def hold(db, *, user=1, size=10, category=Category.UPLOAD, key=None, now=None, expiry=None):
    instant = now or utc_now()
    return quota.create_hold(
        db,
        user_id=user,
        category=category,
        bytes_count=size,
        command_key=key or str(uuid4()),
        expires_at=expiry or instant + timedelta(hours=1),
        now=instant,
    )


@pytest.mark.parametrize("plan,expected", [(Plan.FREE, 100), (Plan.PLUS, 1000), (Plan.PRO, 10000)])
def test_plan_capacity_and_consumption(database, plan, expected):
    with Session(database) as db:
        quota.entitlements.change_plan(db, 1, plan)
        assert quota.snapshot_user(db, 1).available_bytes == expected
        claim = hold(db, size=expected)
        assert quota.consume_hold(db, claim.hold_id)
        assert not quota.consume_hold(db, claim.hold_id)
        usage.record_allocation(
            db, user_id=1, category=Category.UPLOAD, bytes_count=expected, reason="test"
        )
        assert quota.snapshot_user(db, 1).used_bytes == expected
        with pytest.raises(ValidationException):
            hold(db, size=1)


def test_downgrade_preserves_admitted_hold_and_rejects_new_positive_growth(database):
    with Session(database) as db:
        quota.entitlements.change_plan(db, 1, Plan.PLUS)
        claim = hold(db, size=500)
        db.commit()
        quota.entitlements.change_plan(db, 1, Plan.FREE)
        db.commit()
        assert quota.snapshot_user(db, 1).available_bytes == 0
        with pytest.raises(ValidationException):
            hold(db, size=1)
        db.rollback()
        assert quota.consume_hold(db, claim.hold_id)
        usage.record_allocation(
            db, user_id=1, category=Category.UPLOAD, bytes_count=500, reason="previously_admitted"
        )
        db.commit()
        assert quota.snapshot_user(db, 1).used_bytes == 500
        usage.record_release(
            db, user_id=1, category=Category.UPLOAD, bytes_count=450, reason="delete_over_quota"
        )
        db.commit()
        assert quota.snapshot_user(db, 1).available_bytes == 50


@pytest.mark.parametrize("limit", [None, -1])
def test_policy_requires_nonnegative_finite_capacity(database, limit):
    with Session(database) as db:
        db.get(StoragePlanPolicy, "FREE").default_limit_bytes = limit
        with pytest.raises(IntegrityError):
            db.flush()


def test_zero_capacity_rejects_new_holds(database):
    with Session(database) as db:
        db.get(StoragePlanPolicy, "FREE").default_limit_bytes = 0
        db.flush()
        assert quota.snapshot_user(db, 1).available_bytes == 0
        with pytest.raises(ValidationException):
            hold(db, size=1)


def test_entitlement_rejects_unknown_plan(database):
    with Session(database) as db:
        db.get(UserStorageEntitlement, 1).plan_code = "UNKNOWN"
        with pytest.raises(IntegrityError):
            db.flush()


@pytest.mark.parametrize(
    "category", [Category.DERIVED_RENDER, Category.DERIVED_AUDIO, Category.TEMP_IMPORT]
)
def test_nonquota_categories_never_admit_holds(database, category):
    with Session(database) as db:
        with pytest.raises(ValueError):
            hold(db, category=category)
        assert db.scalar(select(func.count()).select_from(StorageQuotaHold)) == 0


@pytest.mark.parametrize("target", [Status.CONSUMED, Status.RELEASED, Status.EXPIRED])
def test_terminal_holds_are_idempotent_and_never_reactivate(database, target):
    now = utc_now()
    expiry = now + timedelta(hours=1)
    with Session(database) as db:
        claim = hold(db, key="one-command", now=now, expiry=expiry)
        assert hold(db, key="one-command", now=now, expiry=expiry).hold_id == claim.hold_id
        if target == Status.CONSUMED:
            assert quota.consume_hold(db, claim.hold_id)
        elif target == Status.RELEASED:
            assert quota.release_hold(db, claim.hold_id, now=now)
        else:
            assert storage_quota_expiry.expire_due(db, now=expiry) == 1
        assert hold(db, key="one-command", now=now, expiry=expiry).status == target
        with pytest.raises(ValueError):
            hold_transition(target, Status.HELD, expires_at=expiry, now=now)
        if target != Status.CONSUMED:
            with pytest.raises(ConflictException):
                quota.consume_hold(db, claim.hold_id)
        db.commit()
        assert db.scalar(select(func.count()).select_from(StorageQuotaHold)) == 1


@pytest.mark.parametrize("target", [Status.RELEASED, Status.CONSUMED])
def test_competing_hold_transition_has_one_winner(database, target):
    with Session(database) as db:
        claim = hold(db)
        db.commit()
    barrier = Barrier(2)

    def transition():
        with Session(database) as db:
            barrier.wait(timeout=10)
            changed = (quota.consume_hold if target == Status.CONSUMED else quota.release_hold)(
                db, claim.hold_id
            )
            if changed and target == Status.CONSUMED:
                usage.record_allocation(
                    db, user_id=1, category=Category.UPLOAD, bytes_count=10, reason="race"
                )
            db.commit()
            return changed

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: transition(), range(2)))
    assert sorted(results) == [False, True]
    with Session(database) as db:
        assert db.get(StorageUsageAccount, 1).used_bytes == (10 if target == Status.CONSUMED else 0)
        assert db.scalar(select(func.count()).select_from(StorageUsageEvent)) == (
            1 if target == Status.CONSUMED else 0
        )


def test_concurrent_admission_cannot_oversubscribe(database):
    barrier = Barrier(2)

    def admit():
        with Session(database) as db:
            barrier.wait(timeout=10)
            try:
                hold(db, size=60)
                db.commit()
                return True
            except ValidationException:
                db.rollback()
                return False

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: admit(), range(2)))
    assert sorted(results) == [False, True]
    with Session(database) as db:
        assert quota.snapshot_user(db, 1).reserved_bytes == 60


def test_other_user_does_not_wait_on_shared_plan(database):
    with Session(database) as first, ThreadPoolExecutor(1) as pool:
        hold(first)

        def other():
            with Session(database) as second:
                hold(second, user=2)
                second.commit()

        try:
            pool.submit(other).result(timeout=5)
        finally:
            first.rollback()


def test_expired_capacity_is_available_before_worker_and_cannot_be_consumed(database):
    now = utc_now()
    expired = now - timedelta(seconds=1)
    with Session(database) as db:
        claim = hold(db, size=100, now=expired - timedelta(seconds=1), expiry=expired)
        db.commit()
        assert quota.snapshot_user(db, 1).available_bytes == 100
        with pytest.raises(ConflictException):
            quota.consume_hold(db, claim.hold_id)
        db.rollback()
        assert db.get(StorageQuotaHold, claim.hold_id).status == Status.HELD
        hold(db, size=100)
        db.commit()
        assert storage_quota_expiry.expire_due(db) == 1
        assert storage_quota_expiry.expire_due(db) == 0
        db.commit()


@pytest.mark.parametrize("expiry_wins", [False, True])
def test_expiry_consumption_serializes_at_hold_deadline(database, expiry_wins):
    now = utc_now()
    expiry = now + timedelta(hours=1)
    with Session(database) as db:
        claim = hold(db, now=now, expiry=expiry)
        db.commit()
    with Session(database) as winner, ThreadPoolExecutor(1) as pool:
        if expiry_wins:
            assert storage_quota_expiry.expire_due(winner, now=expiry) == 1
        else:
            assert quota.consume_hold(winner, claim.hold_id)

        def loser():
            with Session(database) as db:
                if expiry_wins:
                    with pytest.raises(ConflictException):
                        quota.consume_hold(db, claim.hold_id)
                else:
                    assert storage_quota_expiry.expire_due(db, now=expiry) == 0
                db.commit()

        pending = pool.submit(loser)
        winner.commit()
        pending.result(timeout=10)
    with Session(database) as db:
        assert db.get(StorageQuotaHold, claim.hold_id).status == (
            Status.EXPIRED if expiry_wins else Status.CONSUMED
        )


def test_bounded_expiry_skips_locked_user_and_does_not_touch_business_state(database):
    now = utc_now()
    with Session(database) as db:
        for n in range(4):
            hold(
                db,
                size=1,
                user=1 if n < 2 else 2,
                now=now - timedelta(hours=2),
                expiry=now - timedelta(hours=1),
            )
        db.commit()
    with Session(database) as locked:
        quota.lock_user(locked, 1)
        with Session(database) as worker:
            assert storage_quota_expiry.expire_due(worker, limit=3, now=now) == 1
            worker.commit()
    with Session(database) as db:
        assert storage_quota_expiry.expire_due(db, limit=2, now=now) == 2
        db.commit()
        assert storage_quota_expiry.expire_due(db, limit=2, now=now) == 1
        db.commit()


def test_consumption_and_allocation_rollback_together(database):
    with Session(database) as db:
        claim = hold(db)
        db.commit()
    with Session(database) as db:
        assert quota.consume_hold(db, claim.hold_id)
        usage.record_allocation(
            db, user_id=1, category=Category.UPLOAD, bytes_count=10, reason="rollback"
        )
        db.rollback()
    with Session(database) as db:
        assert db.get(StorageQuotaHold, claim.hold_id).status == Status.HELD
        assert db.get(StorageUsageAccount, 1).used_bytes == 0
        assert db.scalar(select(func.count()).select_from(StorageUsageEvent)) == 0


@pytest.mark.parametrize("plan,limit", [(Plan.FREE, 100), (Plan.PLUS, 1000), (Plan.PRO, 10000)])
def test_http_quota_and_category_holds(database, client, plan, limit):
    with Session(database) as db:
        quota.entitlements.change_plan(db, 1, plan)
        hold(db, size=11, category=Category.SOURCE)
        hold(db, size=7, category=Category.UPLOAD)
        usage.record_allocation(
            db, user_id=1, category=Category.INPUT_ASSET, bytes_count=3, reason="fixture"
        )
        db.commit()
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: db.get(User, 1)
        try:
            response = client.get("/api/v1/me/storage-usage")
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)
        assert response.status_code == 200
        assert response.json()["quota"] == {
            "used_bytes": 3,
            "reserved_bytes": 18,
            "limit_bytes": limit,
            "available_bytes": limit - 21,
        }
        breakdown = {item["category"]: item for item in response.json()["breakdown"]}
        assert breakdown["SOURCE"]["reserved_bytes"] == 11
        assert breakdown["UPLOAD"]["reserved_bytes"] == 7
        assert breakdown["INPUT_ASSET"]["used_bytes"] == 3


@pytest.mark.parametrize("value", [True, False, 1.0, 1.5, 0.0, 0, -1, "1", None])
def test_capacity_requires_exact_positive_integer(database, value):
    from app.modules.storage_governance.quota.domain import admit_capacity
    from app.modules.storage_governance.quota.contracts import EffectiveStorageQuota

    with Session(database) as db:
        for limit in [0, 100]:
            with pytest.raises(ValueError):
                admit_capacity(EffectiveStorageQuota(Plan.FREE, limit), 0, 0, value)
            with pytest.raises(ValueError):
                hold(db, size=value)
        assert db.scalar(select(func.count()).select_from(StorageQuotaHold)) == 0


@pytest.mark.parametrize(
    "syntax",
    [
        "import app.modules.storage_governance.quota.service as quota",
        "from app.modules.storage_governance.quota import service",
        "from ..quota import service",
        "from ...quota import service",
    ],
)
def test_boundary_import_resolution_covers_import_forms_and_nested_files(tmp_path, syntax):
    from tests.support.python_imports import imported_modules

    nested = "...quota" in syntax
    path = (
        tmp_path
        / "app/modules/storage_governance/usage"
        / ("nested/check.py" if nested else "check.py")
    )
    path.parent.mkdir(parents=True)
    path.write_text(syntax, encoding="utf-8")
    assert "app.modules.storage_governance.quota.service" in imported_modules(path, tmp_path)


def test_concurrent_command_retry_reuses_one_hold(database):
    expiry = utc_now() + timedelta(hours=1)
    barrier = Barrier(2)

    def admit():
        with Session(database) as db:
            barrier.wait(10)
            result = hold(db, key="same-command", expiry=expiry, size=60)
            db.commit()
            return result.hold_id

    with ThreadPoolExecutor(2) as pool:
        first, second = list(pool.map(lambda _: admit(), range(2)))
    assert first == second
    with Session(database) as db:
        assert db.scalar(select(func.count()).select_from(StorageQuotaHold)) == 1
        assert quota.snapshot_user(db, 1).reserved_bytes == 60


@pytest.mark.parametrize("failure", [False, True])
def test_expiry_execution_owns_batch_commit_and_rollback(database, monkeypatch, failure):
    from sqlalchemy.orm import sessionmaker
    from app.worker.execution import maintenance_cleanup as execution

    now = utc_now()
    with Session(database) as db:
        claim = hold(db, now=now - timedelta(hours=2), expiry=now - timedelta(hours=1))
        db.commit()
    monkeypatch.setattr(execution, "SessionLocal", sessionmaker(database))
    monkeypatch.setattr(execution, "run_scheduler_scan", lambda key, scan: scan())
    expire = storage_quota_expiry.expire_due
    if failure:

        def interrupted(db):
            assert expire(db) == 1
            raise RuntimeError("expiry transaction interrupted")

        monkeypatch.setattr(storage_quota_expiry, "expire_due", interrupted)
        with pytest.raises(RuntimeError, match="interrupted"):
            execution.execute_storage_quota_expiry()
    else:
        assert execution.execute_storage_quota_expiry() == {"expired_holds": 1}
    with Session(database) as db:
        assert db.get(StorageQuotaHold, claim.hold_id).status == (
            Status.HELD if failure else Status.EXPIRED
        )


def test_consumption_rechecks_clock_after_waiting_for_user_fence(database, monkeypatch):
    from threading import Event
    from sqlalchemy import text
    from tests.test_stored_object_retirement_postgres import assert_blocked
    import app.modules.storage_governance.quota.service as service_module

    now = utc_now()
    expiry = now + timedelta(hours=1)
    with Session(database) as db:
        claim = hold(db, expiry=expiry)
        db.commit()
    clock = [now]
    monkeypatch.setattr(service_module, "utc_now", lambda: clock[0])
    started = Event()
    pids = []

    def consume():
        with Session(database) as db:
            pids.append(db.scalar(text("SELECT pg_backend_pid()")))
            started.set()
            with pytest.raises(ConflictException):
                quota.consume_hold(db, claim.hold_id)
            db.rollback()

    with Session(database) as owner, ThreadPoolExecutor(1) as pool:
        quota.lock_user(owner, 1)
        pending = pool.submit(consume)
        assert started.wait(10)
        assert_blocked(database, pids[0])
        clock[0] = expiry
        owner.commit()
        pending.result(timeout=10)
    with Session(database) as db:
        assert db.get(StorageQuotaHold, claim.hold_id).status == Status.HELD


def test_expiry_missing_entitlement_fails_closed(database):
    from app.core.exceptions import AppException
    from sqlalchemy import delete

    now = utc_now()
    with Session(database) as db:
        hold(db, now=now - timedelta(hours=2), expiry=now - timedelta(hours=1))
        db.execute(delete(UserStorageEntitlement).where(UserStorageEntitlement.user_id == 1))
        db.commit()
        with pytest.raises(AppException) as error:
            storage_quota_expiry.expire_due(db)
        assert error.value.code == "quota_check_unavailable"


def test_cleanup_release_of_rolled_back_hold_is_idempotent(database):
    with Session(database) as db:
        claim = hold(db)
        db.rollback()
        assert not quota.release_hold(db, claim.hold_id)
        assert db.scalar(select(func.count()).select_from(StorageQuotaHold)) == 0


def test_user_cascade_preserves_business_hold_fk_consistency(database):
    from app.db.models import PerformanceTakeManifest, PerformanceTakeUploadReservation

    with Session(database) as db:
        claim = hold(db)
        manifest = PerformanceTakeManifest(
            user_id=1, take_uuid="teardown", manifest_json="{}", manifest_sha256="a" * 64
        )
        db.add(manifest)
        db.flush()
        db.add(
            PerformanceTakeUploadReservation(
                user_id=1,
                manifest_id=manifest.id,
                client_request_id="teardown",
                staging_object_key="staging",
                quota_hold_id=claim.hold_id,
                expires_at=claim.expires_at,
            )
        )
        db.commit()
        db.delete(db.get(User, 1))
        db.commit()
        assert db.get(StorageQuotaHold, claim.hold_id) is None
        assert db.scalar(select(func.count()).select_from(PerformanceTakeUploadReservation)) == 0


def test_customer_snapshot_serializes_with_consumption_and_allocation(database):
    from threading import Event
    from sqlalchemy import text
    from tests.test_stored_object_retirement_postgres import assert_blocked

    with Session(database) as db:
        claim = hold(db)
        db.commit()
    started = Event()
    pids = []

    def read():
        with Session(database) as db:
            pids.append(db.scalar(text("SELECT pg_backend_pid()")))
            started.set()
            return read_storage_usage(db, 1)

    with Session(database) as writer, ThreadPoolExecutor(1) as pool:
        assert quota.consume_hold(writer, claim.hold_id)
        usage.record_allocation(
            writer, user_id=1, category=Category.UPLOAD, bytes_count=10, reason="snapshot"
        )
        pending = pool.submit(read)
        assert started.wait(10)
        try:
            assert_blocked(database, pids[0])
        finally:
            writer.commit()
        snapshot = pending.result(timeout=10)
    assert snapshot.quota.model_dump() == {
        "used_bytes": 10,
        "reserved_bytes": 0,
        "limit_bytes": 100,
        "available_bytes": 90,
    }
    category = next(item for item in snapshot.breakdown if item.category == Category.UPLOAD)
    assert category.used_bytes == 10 and category.reserved_bytes == 0
