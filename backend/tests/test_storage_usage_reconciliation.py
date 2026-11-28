"""Current semantic inventory and exact, caller-owned projection maintenance."""

from tests.support.uploads import settled_upload_session

from app.composition import storage_resources as _resource_wiring

from tests.support.quota import admit_hold
from tests.support.quota import allocate_hold
from app.composition.storage_resources import storage_quota_service

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep
import ast
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy import select, func, text, delete
from sqlalchemy.orm import Session

from app.db.models import (
    User,
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    ImportJob,
    ImportArtifact,
    Upload,
    ScoreInputAsset,
    StoredObject,
    PerformanceTake,
    PerformanceTakeManifest,
    PracticeBundleRecord,
    StoragePlanPolicy,
    StorageUsageAccount,
    StorageUsageCounter,
    StorageUsageEvent,
    StorageQuotaHold,
    UserStorageEntitlement,
)
from app.modules.import_jobs.domain import ImportArtifactKind
from app.modules.practice.bundle.states import PracticeBundleStatus
from app.modules.storage_governance.usage.domain import StorageUsageCategory as Category
from app.modules.revisions.domain import RevisionOrigin
from app.modules.revisions.domain import RevisionSourceFormat
from app.modules.score_assets.domain import RenderAssetKind
from app.modules.playback.domain import PlaybackAssetKind
from app.modules.import_jobs.domain import ImportJobState
from app.modules.import_jobs.requested_options import encode_requested_options
from app.modules.storage_governance.usage.contracts import counts_toward_quota
from app.modules.storage_governance.usage.accounting import (
    StorageUsageInvariantError,
    new_usage_event,
)
from app.composition.storage_resources import provision_storage_resources
from app.composition.storage_inventory import build_storage_inventory_registry
from app.modules.storage_governance.usage.reconciliation import (
    StorageUsageReconciliation,
    UsageTotals,
)
from app.composition.storage_resources import storage_usage_service as usage


@pytest.fixture
def database(postgres_engine):
    with Session(postgres_engine) as db:
        db.add_all(
            [User(id=n, email=f"reconcile{n}@example.test", password_hash="hash") for n in (1, 2)]
        )
        db.add(StoragePlanPolicy(plan_code="FREE", default_limit_bytes=100000))
        db.flush()
        for n in (1, 2):
            provision_storage_resources(db, n)
        db.commit()
    return postgres_engine


def obj(db, name, size):
    # Locators intentionally carry no category information.
    row = StoredObject(
        object_key=f"opaque/{name}",
        byte_size=size,
        sha256="a" * 64,
        content_type="application/octet-stream",
    )
    db.add(row)
    db.flush()
    return row


def upload(db, name, size, user=1):
    row = Upload(
        upload_session=settled_upload_session(user_id=user),
        upload_uuid=name,
        uploader_user_id=user,
        stored_object_id=obj(db, name, size).id,
        original_filename=name,
    )
    db.add(row)
    db.flush()
    return row


def inventory(db):
    scores = [
        Score(score_uuid=f"score-{n}", owner_user_id=1, display_title="Inventory") for n in (1, 2)
    ]
    db.add_all(scores)
    db.flush()
    rev = ScoreRevision(
        revision_uuid="rev",
        score_id=scores[0].id,
        revision_number=1,
        content_hash="a" * 64,
        origin=RevisionOrigin.EDIT,
    )
    db.add(rev)
    db.flush()
    db.add(
        ScoreRevisionSource(
            source_uuid="source",
            revision_id=rev.id,
            stored_object_id=obj(db, "source", 11).id,
            format=RevisionSourceFormat.MUSICXML,
            filename="source",
            generator="test",
            generator_version="1",
        )
    )
    db.add(
        ScoreRenderAsset(
            asset_uuid="render",
            revision_id=rev.id,
            stored_object_id=obj(db, "page", 13).id,
            kind=RenderAssetKind.RENDERED_PAGE,
            render_profile="default",
            page_number=1,
            filename="page",
            generator="test",
            generator_version="1",
        )
    )
    db.add(
        ScorePlaybackAsset(
            asset_uuid="audio",
            revision_id=rev.id,
            stored_object_id=obj(db, "audio", 17).id,
            kind=PlaybackAssetKind.AUDIO,
            source_fingerprint="f" * 64,
            filename="audio",
            generator="test",
            generator_version="1",
        )
    )
    job = ImportJob(
        job_uuid="job",
        user_id=1,
        state=ImportJobState.QUEUED,
        requested_options=encode_requested_options(None),
    )
    db.add(job)
    db.flush()
    db.add(
        ImportArtifact(
            job_id=job.id,
            artifact_uuid="artifact",
            kind=ImportArtifactKind.REVIEW_MUSICXML,
            stored_object_id=obj(db, "artifact", 19).id,
            filename="score.musicxml",
        )
    )
    upload(db, "ordinary", 23)
    backing = upload(db, "backing", 29, user=2)
    for n, score in enumerate(scores):
        db.add(ScoreInputAsset(asset_uuid=f"input-{n}", score_id=score.id, upload_id=backing.id))
    manifest = PerformanceTakeManifest(
        user_id=1, take_uuid="take", manifest_json="{}", manifest_sha256="b" * 64
    )
    db.add(manifest)
    db.flush()
    db.add(
        PerformanceTake(
            owner_user_id=manifest.user_id,
            manifest_id=manifest.id,
            recording_object_id=obj(db, "recording", 31).id,
        )
    )
    # Exclusions share the same physical fact type, but have no accounting category.
    db.get(User, 1).avatar_object_id = obj(db, "avatar", 1001).id
    db.add(
        PracticeBundleRecord(
            bundle_id="bundle",
            artifact_id="artifact",
            artifact_schema_version=1,
            status=PracticeBundleStatus.READY,
            prepared_musicxml_object_id=obj(db, "bundle-xml", 1003).id,
            artifact_object_id=obj(db, "bundle-json", 1007).id,
        )
    )
    db.commit()
    return {
        Category.SOURCE: 11,
        Category.UPLOAD: 54,
        Category.INPUT_ASSET: 58,
        Category.DERIVED_RENDER: 13,
        Category.DERIVED_AUDIO: 17,
        Category.TEMP_IMPORT: 19,
    }


def test_inventory_counts_semantic_rows_and_intentionally_excludes_unaccounted_owners(database):
    with Session(database) as db:
        expected = inventory(db)
        assert build_storage_inventory_registry().snapshot_user(db, 1).used_bytes == expected
        assert build_storage_inventory_registry().snapshot_user(db, 2).used_bytes == dict.fromkeys(
            Category, 0
        )  # backing Upload is promoted
        report = StorageUsageReconciliation(
            build_storage_inventory_registry(), usage=_resource_wiring.storage_usage_service
        ).inspect_user(db, 1)
        assert {item.category: item.expected.used_bytes for item in report.categories} == expected
        assert report.expected_account.used_bytes == 11 + 54 + 58
        assert set(expected) == set(Category)


def test_repair_uses_semantic_facts_preserves_holds_and_is_transactional_and_idempotent(database):
    reconcile = StorageUsageReconciliation(
        build_storage_inventory_registry(), usage=_resource_wiring.storage_usage_service
    )
    with Session(database) as db:
        expected = inventory(db)
        for category in Category:
            db.add(StorageUsageCounter(user_id=1, category=category, used_bytes=3))
        account = db.get(StorageUsageAccount, 1)
        account.used_bytes = 999
        claim = admit_hold(db, user_id=1, category=Category.UPLOAD, bytes_count=5)
        held_before = db.get(StorageQuotaHold, claim.hold_id).model_dump()
        misleading = new_usage_event(
            user_id=1,
            category=Category.UPLOAD,
            delta_bytes=99999,
            counts_toward_quota=True,
            reason="evidence",
        )
        db.add(misleading)
        db.commit()
        db.refresh(misleading)
        original_event = misleading.model_dump()
        before = reconcile.inspect_user(db, 1)
        assert before.drift and before.actual_account == UsageTotals(999)
        assert before.expected_account == UsageTotals(123)
        assert db.get(StorageQuotaHold, claim.hold_id).model_dump() == held_before
        assert not db.new and not db.dirty
        assert reconcile.reconcile_user(db, 1) == before
        assert not reconcile.inspect_user(db, 1).drift
        db.rollback()
        assert reconcile.inspect_user(db, 1) == before
        reconcile.reconcile_user(db, 1)
        db.commit()
        corrections = db.scalars(
            select(StorageUsageEvent).where(StorageUsageEvent.reason == "reconciliation")
        ).all()
        assert {item.category: item.delta_bytes for item in corrections} == {
            category: value - 3 for category, value in expected.items()
        }
        assert all(
            item.object_type is item.object_id is item.storage_key is None for item in corrections
        )
        assert all(
            item.counts_toward_quota_snapshot == counts_toward_quota(item.category)
            for item in corrections
        )
        assert db.get(StorageUsageEvent, misleading.id).model_dump() == original_event
        assert not reconcile.reconcile_user(db, 1).drift
        db.commit()
        assert db.scalar(select(func.count()).select_from(StorageUsageEvent)) == 7


def test_repair_creates_missing_counters_without_reprovisioning_or_spurious_events(database):
    with Session(database) as db:
        report = StorageUsageReconciliation(
            build_storage_inventory_registry(), usage=_resource_wiring.storage_usage_service
        ).reconcile_user(db, 1)
        assert not report.drift
        assert all(not item.counter_exists for item in report.categories)
        assert (
            not StorageUsageReconciliation(
                build_storage_inventory_registry(), usage=_resource_wiring.storage_usage_service
            )
            .inspect_user(db, 1)
            .drift
        )
        assert set(db.scalars(select(StorageUsageCounter.category))) == set(Category)
        assert db.scalar(select(func.count()).select_from(StorageUsageEvent)) == 0
        db.rollback()
        assert db.scalar(select(func.count()).select_from(StorageUsageCounter)) == 0


@pytest.mark.parametrize("missing", [StorageUsageAccount])
def test_maintenance_does_not_repair_missing_provisioning_authorities(database, missing):
    from app.core.exceptions import AppException

    with Session(database) as db:
        db.execute(delete(missing).where(missing.user_id == 1))
        with pytest.raises(AppException) as error:
            StorageUsageReconciliation(
                build_storage_inventory_registry(), usage=_resource_wiring.storage_usage_service
            ).reconcile_user(db, 1)
        assert error.value.code == "quota_check_unavailable"


@pytest.mark.parametrize("category", [Category.SOURCE, Category.DERIVED_RENDER])
@pytest.mark.parametrize("failure", ["counter", "account", "missing_counter"])
def test_exact_release_requires_the_full_allocation_before_any_mutation(
    database, category, failure
):
    if failure == "account" and not counts_toward_quota(category):
        return
    with Session(database) as db:
        usage.record_allocation(db, user_id=1, category=category, bytes_count=10, reason="seed")
        db.commit()
        if failure == "account":
            db.get(StorageUsageAccount, 1).used_bytes = 5
        elif failure == "missing_counter":
            db.execute(delete(StorageUsageCounter))
        db.commit()
        before = {
            model: db.execute(select(model.__table__)).mappings().all()
            for model in [StorageUsageCounter, StorageUsageAccount, StorageUsageEvent]
        }
        with pytest.raises(StorageUsageInvariantError):
            usage.record_release(
                db,
                user_id=1,
                category=category,
                bytes_count=6 if failure == "account" else 11,
                reason="release",
            )
        db.flush()
        assert {
            model: db.execute(select(model.__table__)).mappings().all() for model in before
        } == before


def test_exact_release_records_the_requested_delta(database):
    with Session(database) as db:
        usage.record_allocation(
            db, user_id=1, category=Category.UPLOAD, bytes_count=10, reason="seed"
        )
        usage.record_release(
            db, user_id=1, category=Category.UPLOAD, bytes_count=4, reason="release"
        )
        assert db.get(StorageUsageAccount, 1).used_bytes == 6
        assert db.scalar(select(StorageUsageCounter)).used_bytes == 6
        assert (
            db.scalar(
                select(StorageUsageEvent.delta_bytes).where(StorageUsageEvent.reason == "release")
            )
            == -4
        )


@pytest.mark.parametrize("operation", ["allocation", "reservation", "commit", "release"])
@pytest.mark.parametrize("winner", ["domain", "reconciler"])
def test_maintenance_serializes_with_semantic_and_hold_transactions(database, operation, winner):
    reconcile = StorageUsageReconciliation(
        build_storage_inventory_registry(), usage=_resource_wiring.storage_usage_service
    )
    entered = Event()
    waiter_pid = []
    hold = None
    if operation in {"commit", "release"}:
        with Session(database) as db:
            hold = admit_hold(db, user_id=1, category=Category.UPLOAD, bytes_count=37)
            db.commit()

    def domain(db):
        if operation == "allocation":
            upload(db, "concurrent", 37)
            usage.record_allocation(
                db, user_id=1, category=Category.UPLOAD, bytes_count=37, reason="test"
            )
        elif operation == "commit":
            upload(db, "committed", 37)
            allocate_hold(db, hold.hold_id)
        elif operation == "release":
            storage_quota_service.release_hold(db, hold.hold_id)
        else:
            admit_hold(db, user_id=1, category=Category.UPLOAD, bytes_count=37)

    def waiter():
        with Session(database, expire_on_commit=False) as db:
            # Preload projections to prove refresh under the account lock.
            db.get(StorageUsageAccount, 1)
            db.scalars(select(StorageUsageCounter)).all()
            waiter_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            if winner == "reconciler" and operation == "allocation":
                upload(
                    db, "concurrent", 37
                )  # uncommitted semantic write before account acquisition
            entered.set()
            if winner == "domain":
                reconcile.reconcile_user(db, 1)
            elif operation == "allocation":
                usage.record_allocation(
                    db, user_id=1, category=Category.UPLOAD, bytes_count=37, reason="test"
                )
            else:
                domain(db)
            db.commit()

    with ThreadPoolExecutor(max_workers=1) as pool, Session(database) as db:
        if winner == "domain":
            domain(db)
        else:
            reconcile.reconcile_user(db, 1)
        future = pool.submit(waiter)
        try:
            assert entered.wait(10)
            with database.connect() as observer:
                deadline = monotonic() + 10
                while (
                    observer.scalar(
                        text("SELECT wait_event_type FROM pg_stat_activity WHERE pid=:pid"),
                        {"pid": waiter_pid[0]},
                    )
                    != "Lock"
                ):
                    assert monotonic() < deadline
                    sleep(0.01)
            assert not future.done()
            db.commit()
        finally:
            db.rollback()
        future.result(timeout=10)
    with Session(database) as db:
        assert not reconcile.inspect_user(db, 1).drift
        account = db.get(StorageUsageAccount, 1)
        assert (account.used_bytes, storage_quota_service.snapshot_user(db, 1).reserved_bytes) == (
            (37, 0)
            if operation in {"allocation", "commit"}
            else ((0, 0) if operation == "release" else (0, 37))
        )


def test_inventory_and_maintenance_have_no_object_store_or_event_reconstruction_dependency(
    database,
):
    import app.modules.storage_governance.inventory.registry as inventory_module
    import app.modules.storage_governance.usage.reconciliation as reconciliation_module

    for module in [inventory_module, reconciliation_module]:
        tree = ast.parse(Path(module.__file__).read_text())
        imports = [node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
        assert not any(
            name
            and (name.startswith("app.storage") or name.startswith("app.modules.media_storage"))
            for name in imports
        )
    # Complete composition returns explicit zero totals for an empty semantic inventory.
    with Session(database) as db:
        assert build_storage_inventory_registry().snapshot_user(db, 1).used_bytes == dict.fromkeys(
            Category, 0
        )


def test_missing_plan_policy_fails_closed_without_mutation(database):
    from app.core.exceptions import AppException

    with (
        Session(database) as db,
        patch.object(storage_quota_service.repository, "policy", return_value=None),
    ):
        with pytest.raises(AppException) as error:
            storage_quota_service.snapshot_user(db, 1)
        assert error.value.code == "quota_check_unavailable"
        assert not db.new and not db.dirty


def test_inspection_is_a_read_only_inventory_without_event_reads(database):
    from sqlalchemy import event

    with Session(database) as db:
        inventory(db)
        statements = []

        def record(_conn, _cursor, statement, _params, _context, _many):
            statements.append(statement.upper())

        event.listen(database, "before_cursor_execute", record)
        try:
            StorageUsageReconciliation(
                build_storage_inventory_registry(), usage=_resource_wiring.storage_usage_service
            ).inspect_user(db, 1)
        finally:
            event.remove(database, "before_cursor_execute", record)
        assert statements and all(
            not statement.startswith(("INSERT", "UPDATE", "DELETE")) for statement in statements
        )
        assert all("STORAGE_USAGE_EVENTS" not in statement for statement in statements)
        assert not db.new and not db.dirty


@pytest.mark.parametrize("command", ["inspect", "repair"])
def test_operator_command_has_explicit_transaction_ownership_and_opaque_output(
    database, monkeypatch, capsys, command
):
    import sys
    from scripts import reconcile_storage_usage as cli

    with Session(database) as db:
        upload(db, "sensitive-filename-and-locator", 13)
        db.commit()
    monkeypatch.setattr(cli, "build_engine", lambda config: database)
    monkeypatch.setattr(sys, "argv", ["reconcile_storage_usage.py", command, "1"])
    cli.main()
    output = capsys.readouterr().out
    assert '"user_id": 1' in output and '"drift": true' in output
    assert "sensitive-filename-and-locator" not in output and "opaque/" not in output
    with Session(database) as db:
        assert StorageUsageReconciliation(
            build_storage_inventory_registry(), usage=_resource_wiring.storage_usage_service
        ).inspect_user(db, 1).drift == (command == "inspect")
        if command == "repair":
            assert db.get(StorageUsageAccount, 1).used_bytes == 13
            assert db.scalar(select(func.count()).select_from(StorageUsageCounter)) == len(Category)


def test_inspection_never_flushes_pending_caller_writes(database):
    with Session(database) as db:
        account = db.get(StorageUsageAccount, 1)
        account.used_bytes = 123
        pending = StorageUsageEvent(
            user_id=1,
            category=Category.UPLOAD,
            delta_bytes=999,
            counts_toward_quota_snapshot=True,
            reason="pending",
        )
        db.add(pending)
        StorageUsageReconciliation(
            build_storage_inventory_registry(), usage=_resource_wiring.storage_usage_service
        ).inspect_user(db, 1)
        assert pending in db.new
        assert account.used_bytes == 123
        with Session(database) as observer:
            assert observer.get(StorageUsageAccount, 1).used_bytes == 0
            assert observer.scalar(select(func.count()).select_from(StorageUsageEvent)) == 0


@pytest.mark.parametrize("model", [StorageUsageEvent])
def test_durable_quota_classification_is_explicitly_a_snapshot(model):
    from app.modules.storage_governance.quota.schemas import StorageUsageBreakdownRead

    assert model.__table__.c.counts_toward_quota_snapshot.nullable is False
    assert "counts_toward_quota_snapshot" in model.model_fields
    assert "counts_toward_quota" not in model.model_fields
    assert "counts_toward_quota" in StorageUsageBreakdownRead.model_fields


def test_request_accounting_uses_projection_while_inventory_is_a_maintenance_boundary():
    import app.modules.storage_governance.usage.service as service

    tree = ast.parse(Path(service.__file__).read_text())
    imports = [node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
    assert not any(name and name.endswith((".inventory", ".reconciliation")) for name in imports)


def test_reconciliation_has_no_entitlement_dependency(database):
    with Session(database) as db:
        db.execute(delete(UserStorageEntitlement).where(UserStorageEntitlement.user_id == 1))
        db.commit()
        assert (
            not StorageUsageReconciliation(
                build_storage_inventory_registry(), usage=_resource_wiring.storage_usage_service
            )
            .reconcile_user(db, 1)
            .drift
        )


@pytest.mark.parametrize("operation", ["record_allocation", "record_release"])
@pytest.mark.parametrize("amount", [True, False, 1.5, -1, None, "1"])
def test_accounting_rejects_invalid_amount_without_projection_or_audit_mutation(
    database, operation, amount
):
    with Session(database) as db:
        with pytest.raises(StorageUsageInvariantError):
            getattr(usage, operation)(
                db, user_id=1, category=Category.UPLOAD, bytes_count=amount, reason="invalid"
            )
        assert db.get(StorageUsageAccount, 1).used_bytes == 0
        assert db.scalar(select(func.count()).select_from(StorageUsageEvent)) == 0
