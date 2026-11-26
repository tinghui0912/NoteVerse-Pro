"""Current entitlement resolution, read-only projections and explicit provisioning."""

from app.composition import storage_resources as _resource_wiring

from tests.support.quota import admit_hold
from tests.support.quota import allocate_hold
from app.composition.storage_resources import storage_quota_service
from app.composition.storage_resources import read_storage_usage

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.exceptions import AppException, ValidationException
from app.db.models import (
    StoragePlanPolicy,
    StorageUsageAccount,
    StorageUsageCounter,
    StorageUsageEvent,
    StorageQuotaHold,
    User,
    UserStorageEntitlement,
)
from app.modules.storage_governance.usage.domain import StorageUsageCategory as Category
from app.modules.storage_governance.quota.states import StoragePlanCode
from app.db.models.auth import PendingRegistration
from app.main import app
from app.modules.auth.email_verification_service import EmailVerificationService
from app.modules.auth.schemas import VerifyEmailRequest
from app.composition.storage_resources import provision_storage_resources
from app.api.resource_dependencies import get_storage_usage_service
from app.modules.storage_governance.usage.service import StorageUsageService
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database


@pytest.fixture
def database(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        yield engine


@pytest.fixture
def provisioned(database):
    with Session(database) as db:
        db.add_all(
            [User(id=n, email=f"storage{n}@example.test", password_hash="hash") for n in (1, 2)]
        )
        db.flush()
        for n in (1, 2):
            provision_storage_resources(db, n)
        db.get(StoragePlanPolicy, "FREE").default_limit_bytes = 100
        db.commit()
    return database


def hold(db, amount, *, user_id=1, category=Category.UPLOAD):
    return admit_hold(db, user_id=user_id, category=category, bytes_count=amount)


def state(db):
    return {
        model.__tablename__: [
            dict(row) for row in db.execute(sa.select(model.__table__)).mappings()
        ]
        for model in (
            StoragePlanPolicy,
            UserStorageEntitlement,
            StorageUsageAccount,
            StorageUsageCounter,
            StorageQuotaHold,
            StorageUsageEvent,
        )
    }


def test_plan_change_applies_to_existing_user_without_mutating_entitlement_or_usage(provisioned):
    service = StorageUsageService()
    with Session(provisioned) as reader:
        service.record_allocation(
            reader, user_id=1, category=Category.SOURCE, bytes_count=20, reason="source"
        )
        hold(reader, 10)
        reader.commit()
        # Keep the ORM identities loaded while another transaction changes policy.
        policy = reader.get(StoragePlanPolicy, "FREE")
        entitlement = reader.get(UserStorageEntitlement, 1)
        account = reader.get(StorageUsageAccount, 1)
        before = (entitlement.model_dump(), account.model_dump())
        assert read_storage_usage(reader, 1).quota.limit_bytes == policy.default_limit_bytes == 100
        with Session(provisioned) as writer:
            writer.get(StoragePlanPolicy, "FREE").default_limit_bytes = 50
            writer.commit()
        usage = read_storage_usage(reader, 1)
        assert (usage.quota.limit_bytes, usage.quota.available_bytes) == (50, 20)
        assert (entitlement.model_dump(), account.model_dump()) == before
        with pytest.raises(ValidationException) as failure:
            hold(reader, 21)
        assert failure.value.details["limit_bytes"] == 50
        assert failure.value.code == "storage_quota_exceeded"
        reader.rollback()


def test_plan_selection_upgrade_and_downgrade_preserve_usage(provisioned):
    with Session(provisioned) as db:
        db.get(StoragePlanPolicy, "PLUS").default_limit_bytes = 150
        storage_quota_service.entitlements.change_plan(db, 1, StoragePlanCode.PLUS)
        db.commit()
        assert read_storage_usage(db, 1).quota.limit_bytes == 150
        with Session(provisioned) as change:
            change.get(StoragePlanPolicy, "FREE").default_limit_bytes = 80
            change.commit()
        assert read_storage_usage(db, 1).quota.limit_bytes == 150
        with pytest.raises(ValidationException):
            hold(db, 151)
        db.rollback()
        storage_quota_service.entitlements.change_plan(db, 1, StoragePlanCode.FREE)
        db.commit()
        assert read_storage_usage(db, 1).quota.limit_bytes == 80
        hold(db, 80)
        assert read_storage_usage(db, 1).quota.available_bytes == 0


def test_lowered_limit_keeps_usage_and_admitted_holds_and_only_blocks_new_counted_reserves(
    provisioned,
):
    service = StorageUsageService()
    with Session(provisioned) as db:
        service.record_allocation(
            db, user_id=1, category=Category.SOURCE, bytes_count=60, reason="source"
        )
        claim = hold(db, 20)
        released = hold(db, 10)
        db.commit()
        db.get(StoragePlanPolicy, "FREE").default_limit_bytes = 50
        db.commit()
        usage = read_storage_usage(db, 1)
        assert (
            usage.quota.used_bytes,
            usage.quota.reserved_bytes,
            usage.quota.available_bytes,
        ) == (60, 30, 0)
        with pytest.raises(ValidationException):
            hold(db, 1)
        db.rollback()
        allocate_hold(db, claim.hold_id)
        storage_quota_service.release_hold(db, released.hold_id)
        service.record_allocation(
            db, user_id=1, category=Category.DERIVED_RENDER, bytes_count=500, reason="render"
        )
        db.commit()
        usage = read_storage_usage(db, 1)
        assert (
            usage.quota.used_bytes,
            usage.quota.reserved_bytes,
            usage.quota.available_bytes,
        ) == (80, 0, 0)
        assert db.get(UserStorageEntitlement, 1).plan_code == "FREE"


def test_usage_get_is_read_only_even_for_an_account_with_no_category_rows(provisioned, client):
    with Session(provisioned) as db:
        before = state(db)
        user = db.get(User, 1)
        statements, flushes = [], []

        def observe(_connection, _cursor, statement, _parameters, _context, _many):
            statements.append(statement.lstrip().split()[0].upper())

        def flush(_db, *_args):
            flushes.append(True)

        sa.event.listen(provisioned, "before_cursor_execute", observe)
        sa.event.listen(db, "before_flush", flush)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: user
        try:
            response = client.get("/api/v1/me/storage-usage")
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)
            sa.event.remove(provisioned, "before_cursor_execute", observe)
            sa.event.remove(db, "before_flush", flush)
        assert response.status_code == 200
        assert set(statements) == {"SELECT"}
        assert flushes == []
        assert state(db) == before
        assert response.json()["quota"] == {
            "used_bytes": 0,
            "reserved_bytes": 0,
            "limit_bytes": 100,
            "available_bytes": 100,
        }


@pytest.mark.parametrize("missing", ["entitlement", "account", "policy"])
def test_missing_authority_fails_closed_without_repair(provisioned, client, monkeypatch, missing):
    service = StorageUsageService()
    with Session(provisioned) as db:
        if missing == "entitlement":
            db.delete(db.get(UserStorageEntitlement, 1))
        elif missing == "account":
            db.delete(db.get(StorageUsageAccount, 1))
        else:
            # A missing referenced policy cannot be constructed under a valid FK.
            monkeypatch.setattr(storage_quota_service.repository, "policy", lambda *_args: None)
        db.commit()
        before = state(db)
        for operation in (
            lambda: read_storage_usage(db, 1),
            lambda: hold_with_service(service, db),
        ):
            with pytest.raises(AppException) as failure:
                operation()
            assert failure.value.code == "quota_check_unavailable"
            assert failure.value.status_code == 503
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: db.get(User, 1)
        app.dependency_overrides[get_storage_usage_service] = lambda: service
        try:
            response = client.get("/api/v1/me/storage-usage")
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)
            app.dependency_overrides.pop(get_storage_usage_service, None)
        assert response.status_code == 503
        assert response.json()["code"] == "quota_check_unavailable"
        assert state(db) == before


def hold_with_service(service, db):
    return admit_hold(db, user_id=1, category=Category.UPLOAD, bytes_count=1)


def test_different_users_do_not_serialize_on_the_shared_plan_row(provisioned):
    with Session(provisioned) as first, ThreadPoolExecutor(max_workers=1) as pool:
        hold(first, 10)

        def other_user():
            with Session(provisioned) as second:
                hold(second, 20, user_id=2)
                second.commit()

        future = pool.submit(other_user)
        try:
            future.result(timeout=5)
        finally:
            first.rollback()
    with Session(provisioned) as db:
        assert storage_quota_service.snapshot_user(db, 1).reserved_bytes == 0
        assert storage_quota_service.snapshot_user(db, 2).reserved_bytes == 20


def test_aggregate_and_category_breakdown_remain_transactionally_consistent(provisioned):
    service = StorageUsageService()
    with Session(provisioned) as db:
        for category in Category:
            service.record_allocation(
                db, user_id=1, category=category, bytes_count=5, reason="allocation"
            )
            if category in {Category.SOURCE, Category.UPLOAD, Category.INPUT_ASSET}:
                hold(db, 2, category=category)
        db.commit()
        usage = read_storage_usage(db, 1)
        assert (usage.quota.used_bytes, usage.quota.reserved_bytes) == (15, 6)
        assert {item.category for item in usage.breakdown if item.counts_toward_quota} == {
            Category.SOURCE,
            Category.UPLOAD,
            Category.INPUT_ASSET,
        }
        assert all(
            (item.used_bytes, item.reserved_bytes) == (5, 2 if item.counts_toward_quota else 0)
            for item in usage.breakdown
        )
        assert (
            sum(item.used_bytes for item in usage.breakdown if item.counts_toward_quota)
            == usage.quota.used_bytes
        )
        assert (
            sum(item.reserved_bytes for item in usage.breakdown if item.counts_toward_quota)
            == usage.quota.reserved_bytes
        )


@pytest.mark.parametrize("outcome", ["success", "missing_default", "account_admission_failure"])
def test_email_verification_provisions_user_storage_in_one_transaction(
    database, monkeypatch, outcome
):
    service = EmailVerificationService(
        provision_storage=_resource_wiring.provision_storage_resources
    )
    token = "verification-token"
    with Session(database) as db:
        db.add(
            PendingRegistration(
                id=1,
                email="new@example.test",
                display_name="New",
                password_hash="hash",
                token_hash=service._hash_token(token),
                expires_at=utc_now() + timedelta(hours=1),
            )
        )
        if outcome == "missing_default":
            db.delete(db.get(StoragePlanPolicy, "FREE"))
        db.commit()
    if outcome == "account_admission_failure":

        def fail_account(_mapper, _connection, _target):
            raise RuntimeError("account admission failed")

        sa.event.listen(StorageUsageAccount, "before_insert", fail_account)
    try:
        with Session(database) as db:
            if outcome == "success":
                user = service.verify_email(db, VerifyEmailRequest(token=token))
                identity = user.id
            else:
                with pytest.raises(AppException if outcome == "missing_default" else RuntimeError):
                    service.verify_email(db, VerifyEmailRequest(token=token))
    finally:
        if outcome == "account_admission_failure":
            sa.event.remove(StorageUsageAccount, "before_insert", fail_account)
    with Session(database) as observer:
        if outcome == "success":
            assert observer.get(User, identity) is not None
            entitlement = observer.get(UserStorageEntitlement, identity)
            account = observer.get(StorageUsageAccount, identity)
            assert entitlement.plan_code == "FREE"
            assert account.used_bytes == 0
            assert storage_quota_service.snapshot_user(observer, identity).reserved_bytes == 0
            assert observer.get(PendingRegistration, 1) is None
        else:
            assert observer.scalar(sa.select(sa.func.count()).select_from(User)) == 0
            assert (
                observer.scalar(sa.select(sa.func.count()).select_from(UserStorageEntitlement)) == 0
            )
            assert observer.scalar(sa.select(sa.func.count()).select_from(StorageUsageAccount)) == 0
            assert observer.get(PendingRegistration, 1).consumed_at is None


@pytest.mark.parametrize(
    "model,field",
    [
        (StoragePlanPolicy, "default_limit_bytes"),
        (StorageUsageAccount, "used_bytes"),
    ],
)
def test_current_storage_facts_enforce_nonnegative_bytes(provisioned, model, field):
    with Session(provisioned) as db:
        with pytest.raises(sa.exc.IntegrityError):
            db.execute(sa.update(model).values({field: -1}))
            db.commit()
        db.rollback()


def test_plan_and_user_identity_constraints_and_user_delete_cascade(provisioned):
    with Session(provisioned) as db:
        with pytest.raises(sa.exc.IntegrityError):
            db.get(UserStorageEntitlement, 1).plan_code = "UNKNOWN"
            db.flush()
        db.rollback()
        db.delete(db.get(User, 1))
        db.commit()
        assert db.get(UserStorageEntitlement, 1) is None
        assert db.get(StorageUsageAccount, 1) is None
        assert db.get(StoragePlanPolicy, "FREE") is not None


def test_zero_policy_and_current_plan_identity_are_resolved_without_snapshot(provisioned):
    with Session(provisioned) as db:
        db.get(StoragePlanPolicy, "FREE").default_limit_bytes = 0
        db.commit()
        assert read_storage_usage(db, 1).quota.limit_bytes == 0
        with pytest.raises(ValidationException):
            hold(db, 1)
        db.rollback()
        db.get(StoragePlanPolicy, "PLUS").default_limit_bytes = 200
        storage_quota_service.entitlements.change_plan(db, 1, StoragePlanCode.PLUS)
        db.commit()
        hold(db, 200)
        assert read_storage_usage(db, 1).quota.available_bytes == 0


@pytest.mark.parametrize("limit", [100, 0, None])
def test_runtime_readiness_observes_the_current_default_plan(database, monkeypatch, limit):
    from app.core.runtime_checks import check_storage_quota_policy

    with Session(database) as db:
        policy = db.get(StoragePlanPolicy, "FREE")
        if limit is None:
            db.delete(policy)
        else:
            policy.default_limit_bytes = limit
        db.commit()
    monkeypatch.setattr("app.db.session.engine", database)
    assert check_storage_quota_policy().ok is (limit is not None)


def test_storage_records_use_plan_and_user_primary_identities(provisioned):
    inspector = sa.inspect(provisioned)
    assert inspector.get_pk_constraint("storage_plan_policies")["constrained_columns"] == [
        "plan_code"
    ]
    assert inspector.get_pk_constraint("user_storage_entitlements")["constrained_columns"] == [
        "user_id"
    ]
    assert inspector.get_pk_constraint("storage_usage_accounts")["constrained_columns"] == [
        "user_id"
    ]
    assert {column["name"] for column in inspector.get_columns("storage_plan_policies")} == {
        "plan_code",
        "default_limit_bytes",
        "created_at",
        "updated_at",
    }
    assert {column["name"] for column in inspector.get_columns("user_storage_entitlements")} == {
        "user_id",
        "plan_code",
        "created_at",
        "updated_at",
    }
    assert {column["name"] for column in inspector.get_columns("storage_usage_accounts")} == {
        "user_id",
        "used_bytes",
        "created_at",
        "updated_at",
    }
