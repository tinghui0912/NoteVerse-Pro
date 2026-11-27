"""Real PostgreSQL retirement/reference fences across independent connections."""

from app.platform.config.stored_object_retirement import StoredObjectRetirementSettings

from tests.support.runtime_resources import resources_for

from tests.support.uploads import complete_image_upload
from tests.support.uploads import settled_upload_session

from app.composition import storage_resources as _resource_wiring


from uuid import uuid4

from app.modules.media_storage.domain import StoredObjectRetirementStatus
from app.modules.performance_takes.upload_reservation.states import UploadReservationStatus

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
)
from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.modules.uploads.service import UploadService
from app.modules.media_storage.persistence import object_from_bytes
from app.modules.media_storage.retirement import retire_after_release, delivery_lifecycle
from app.worker.execution import stored_object_retirement as worker
from app.modules.media_storage import retirement_execution
from app.shared.time import utc_now
from app.runtime.customer_api.context import get_context
from tests.support.runtime_resources import deliveries
from app.platform.config.object_writes import ObjectWriteSettings
from tests.support.worker_context import inject_worker

settings = get_context().settings

pytest_plugins = ["tests.test_practice_bundle_postgres"]

CONTENT = image_bytes()


@pytest.fixture
def retirement_postgres(postgres_bundle, monkeypatch):
    engine, _, _, storage = postgres_bundle
    with engine.connect() as connection:
        connection.scalar(text("SELECT current_schema()"))
    sessions = sessionmaker(engine, expire_on_commit=False)
    inject_worker(monkeypatch, worker, sessions=sessions)
    inject_worker(monkeypatch, worker, storage=storage)
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

    engine, sessions, storage = fixture
    key = "shared/retirement-fixture.png"
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
            )
        )
        db.add(
            StorageUsageCounter(
                user_id=1,
                category=StorageUsageCategory.UPLOAD,
                used_bytes=len(CONTENT) if prior_owner else 0,
            )
        )
        if prior_owner:
            upload = Upload(
                upload_session=settled_upload_session(user_id=1),
                stored_object_id=identity,
                original_filename="initial.png",
                uploader_user_id=1,
            )
            db.add(upload)
        db.commit()
        if prior_owner:
            UploadService(
                quota=_resource_wiring.storage_quota_service,
                usage=_resource_wiring.storage_usage_service,
                uploads=resources_for(storage).build_upload_session_service(),
            ).delete_upload(db, db.get(User, 1), upload.upload_uuid)
            db.commit()
        elif queued:
            retire_after_release(db, identity)
            db.commit()
        operation = db.scalar(select(StoredObjectRetirement))
        uuid = operation.retirement_uuid if operation is not None else None
    return identity, key, uuid


@pytest.mark.parametrize("worker_wins", [False, True])
@pytest.mark.parametrize("prior_owner", [False, True])
def test_retirement_vs_reference_reacquisition_after_last_reference_release(
    retirement_postgres, monkeypatch, worker_wins, prior_owner
):
    engine, sessions, storage = retirement_postgres
    identity, key, uuid = seed(retirement_postgres, prior_owner=prior_owner)
    entered, release = Event(), Event()
    delete, lookup = storage.delete, retirement_execution._object

    def held_delete(key):
        entered.set()
        assert release.wait(15)
        return delete(key)

    def held_lookup(db, object_id):
        entered.set()
        assert release.wait(15)
        return lookup(db, object_id)

    monkeypatch.setattr(
        storage if worker_wins else retirement_execution,
        "delete" if worker_wins else "_object",
        held_delete if worker_wins else held_lookup,
    )
    pid = []

    acquisition_started = Event()

    def upload():
        from app.modules.media_storage.retirement import retain_for_reference
        from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator
        from app.modules.media_storage.adoption import adopt_written_object

        with sessions() as db:
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            acquisition_started.set()
            obj = retain_for_reference(db, identity)
            if obj is None:
                db.commit()
                db.close()
                receipt = ObjectWriteCoordinator(
                    storage, sessions, config=ObjectWriteSettings()
                ).write_bytes(key=key, content=CONTENT, content_type="image/png")
                obj = adopt_written_object(db, receipt)
            row = Upload(
                upload_session=settled_upload_session(user_id=1),
                stored_object_id=obj.id,
                original_filename="reference.png",
                uploader_user_id=1,
            )
            db.add(row)
            _resource_wiring.storage_usage_service.record_allocation(
                db,
                user_id=1,
                category=StorageUsageCategory.UPLOAD,
                bytes_count=len(CONTENT),
                reason="reference_acquired",
            )
            db.flush()
            result = row.upload_uuid
            db.commit()
            return result

    with ThreadPoolExecutor(max_workers=2) as pool:
        deleting = pool.submit(worker.execute_stored_object_retirement_task, None, uuid)
        try:
            assert entered.wait(10)
            uploading = pool.submit(upload)
            if worker_wins:
                assert acquisition_started.wait(10)
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
        row = db.scalar(select(Upload).where(Upload.upload_uuid == uploaded))
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
        old = deliveries().retirement.claim(db, uuid)
        db.commit()
        operation = deliveries().retirement.get(db, uuid)
        operation.started_at = utc_now() - timedelta(
            seconds=delivery_lifecycle(
                config=StoredObjectRetirementSettings.model_validate(
                    get_context().settings.model_dump()
                )
            ).policy.processing_timeout_seconds
        )
        db.commit()
        assert deliveries().retirement.recover_and_list_due(db) == [uuid]
        db.commit()
        current = deliveries().retirement.claim(db, uuid)
        db.commit()
        assert current.attempt == old.attempt + 1
        assert not deliveries().retirement.fail(db, old, "stale")
        db.commit()
        operation_id = deliveries().retirement.get(db, uuid).id
    monkeypatch.setattr(deliveries().retirement, "claim", lambda *_: old)
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
    monkeypatch.setattr(deliveries().retirement, "claim", lambda *_: current)
    assert (await asyncio.to_thread(worker.execute_stored_object_retirement_task, None, uuid))[
        "status"
    ] == "completed"
    assert observations == ["stored_objects", "stored_object_retirements"]
    with Session(engine) as db:
        assert db.get(StoredObject, identity) is None
        assert (
            deliveries().retirement.get(db, uuid).status is StoredObjectRetirementStatus.COMPLETED
        )
        assert not deliveries().retirement.fail(db, old, "stale")
        db.commit()


@pytest.mark.asyncio
async def test_shared_take_release_keeps_lineage_and_accounts_before_physical_retirement(
    postgres_bundle, retirement_postgres, monkeypatch
):
    from tests.support.take_lifecycle import TakeLifecycleServices
    from app.composition.storage_resources import storage_usage_service
    from app.db.models import (
        PerformanceTake,
        PerformanceTakeManifest,
        PerformanceTakeUploadReservation,
    )
    from app.modules.performance_takes.manifest_persistence import manifest_from_row
    from app.modules.media_storage.retirement import retain_for_reference
    from tests.test_upload_reservation_postgres import setup_bundle, MEDIA

    engine, sessions, storage = retirement_postgres
    _, bundles, _, request = setup_bundle(postgres_bundle)
    service = TakeLifecycleServices(storage=storage, practice_bundle_service=bundles)
    with sessions() as db:
        accepted = service.reserve_upload(db, 1, request)
        reservation = service.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        storage.put_bytes(
            key=reservation.upload_session.object_key, content=MEDIA, content_type="audio/webm"
        )
        db.commit()
        service.uploads.complete(reservation.upload_session.session_uuid, 1)
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
            upload_session=settled_upload_session(user_id=1),
            stored_object_id=identity,
            original_filename="recording.webm",
            uploader_user_id=1,
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
        db.commit()
        assert db.scalar(select(PerformanceTake)) is None
        assert db.scalar(select(StoredObjectRetirement)) is None
        assert storage.exists(key)
        assert (db.get(StorageUsageAccount, 1)).used_bytes == len(MEDIA)
        assert manifest_from_row(db.get(PerformanceTakeManifest, manifest_id)) == manifest
        reservation = db.scalar(select(PerformanceTakeUploadReservation))
        assert reservation is not None
        assert reservation.status is UploadReservationStatus.COMPLETED
        UploadService(
            quota=_resource_wiring.storage_quota_service,
            usage=_resource_wiring.storage_usage_service,
            uploads=resources_for(storage).build_upload_session_service(),
        ).delete_upload(db, db.get(User, 1), upload.upload_uuid)
        db.commit()
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


@pytest.mark.parametrize("commit_reached_server", [False, True])
def test_physical_delete_commit_uncertainty_cannot_restore_reference_authority(
    retirement_postgres, monkeypatch, commit_reached_server
):
    from app.modules.media_storage.retirement import retain_for_reference

    engine, sessions, storage = retirement_postgres
    identity, key, uuid = seed(retirement_postgres)

    class UncertainCompletion(Session):
        def commit(self):
            completing = any(
                isinstance(row, StoredObjectRetirement)
                and row.status == StoredObjectRetirementStatus.COMPLETED
                for row in self.identity_map.values()
            )
            if completing:
                assert not storage.exists(key)
                if commit_reached_server:
                    super().commit()
                raise ConnectionError("completion acknowledgement unavailable")
            super().commit()

    inject_worker(
        monkeypatch,
        worker,
        sessions=sessionmaker(engine, class_=UncertainCompletion, expire_on_commit=False),
    )
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "failed"
    assert not storage.exists(key)
    with sessions() as db:
        if commit_reached_server:
            assert db.get(StoredObject, identity) is None
            assert (
                deliveries().retirement.get(db, uuid).status
                == StoredObjectRetirementStatus.COMPLETED
            )
        else:
            assert db.get(StoredObject, identity) is not None
            with pytest.raises(ValueError, match="deletion"):
                retain_for_reference(db, identity)
            db.rollback()

    # Resolve from a fresh transaction, never from the failed completion session.
    inject_worker(monkeypatch, worker, sessions=sessions)
    with sessions() as db:
        operation = deliveries().retirement.get(db, uuid)
        assert operation.deletion_fenced_at is not None
        if not commit_reached_server:
            operation.next_attempt_at = utc_now()
        db.commit()
    outcome = worker.execute_stored_object_retirement_task(None, uuid)
    assert outcome["status"] == ("ignored" if commit_reached_server else "completed")
    with sessions() as db:
        assert db.get(StoredObject, identity) is None
        operation = deliveries().retirement.get(db, uuid)
        assert operation.status == StoredObjectRetirementStatus.COMPLETED
        assert operation.stored_object_id is None and operation.object_key == key
        assert operation.deletion_fenced_at is not None
    with sessions() as db:
        uploaded = complete_image_upload(
            UploadService(
                quota=_resource_wiring.storage_quota_service,
                usage=_resource_wiring.storage_usage_service,
                uploads=resources_for(storage).build_upload_session_service(),
            ),
            db,
            db.get(User, 1),
            UploadFile(filename="rewritten.png", file=io.BytesIO(CONTENT)),
            client_request_id=uuid4().hex,
        )
        assert (
            db.scalar(
                select(Upload).where(Upload.upload_uuid == uploaded.upload_id)
            ).stored_object_id
            != identity
        )
        current = db.scalar(select(Upload).where(Upload.upload_uuid == uploaded.upload_id))
        assert storage.read_bytes(current.stored_object.object_key) == CONTENT
        assert not storage.exists(key)


@pytest.mark.parametrize("missing", [False, True])
def test_retirement_failure_retains_fence_and_retries_missing_key_idempotently(
    retirement_postgres, monkeypatch, missing
):

    from app.modules.media_storage.adoption import adopt_written_object

    engine, sessions, storage = retirement_postgres
    identity, key, uuid = seed(retirement_postgres)
    if missing:
        storage.delete(key)
    remove = storage.delete

    def uncertain_delete(key):
        remove(key)
        raise OSError("provider delete acknowledgement lost")

    monkeypatch.setattr(storage, "delete", uncertain_delete)
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "failed"
    with sessions() as db:
        operation = deliveries().retirement.get(db, uuid)
        fence = operation.deletion_fenced_at
        assert fence is not None and db.get(StoredObject, identity) is not None
        # Even an existing matching receipt cannot manufacture active reference authority.
        receipt = (
            resources_for(storage)
            .build_object_write_coordinator()
            .write_bytes(key=key, content=CONTENT, content_type="image/png")
        )
        with pytest.raises(ValueError, match="deletion"):
            adopt_written_object(db, receipt)
        db.rollback()
        operation = deliveries().retirement.get(db, uuid)
        operation.next_attempt_at = utc_now()
        db.commit()
    monkeypatch.setattr(storage, "delete", remove)
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "completed"
    with sessions() as db:
        assert db.get(StoredObject, identity) is None
        assert deliveries().retirement.get(db, uuid).deletion_fenced_at == fence
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "ignored"


def test_retirement_missing_physical_authority_never_deletes_snapshot_key(
    retirement_postgres, monkeypatch
):
    engine, sessions, storage = retirement_postgres
    identity, key, uuid = seed(retirement_postgres)
    with sessions() as db:
        db.delete(db.get(StoredObject, identity))
        db.commit()

    def forbidden_delete(key):
        raise AssertionError("No physical authority permits deletion")

    monkeypatch.setattr(storage, "delete", forbidden_delete)
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "failed"
    assert storage.exists(key)
    with sessions() as db:
        assert deliveries().retirement.get(db, uuid).deletion_fenced_at is None


@pytest.mark.parametrize("worker_wins", [False, True])
def test_retirement_worker_vs_practice_bundle_reacquisition(
    retirement_postgres, monkeypatch, worker_wins
):
    from sqlalchemy import delete
    from app.db.models import ScoreRevisionPracticeBinding, PracticeBundleRecord
    from app.modules.practice.bundle.retention import PracticeBundleRetention
    from tests.support.practice_bundle import bind_bundle

    engine, sessions, storage = retirement_postgres
    # Use the real compiler and revision parent already provisioned by this fixture.
    from app.modules.practice.bundle.compiler import PracticeBundleCompiler
    from pathlib import Path

    candidate = PracticeBundleCompiler().compile(
        canonical_musicxml=(
            Path(__file__).parent / "fixtures/musicxml/bundle-multi-part.musicxml"
        ).read_bytes()
    )
    from app.db.models import ScoreRevision

    with sessions() as db:
        revision_id = db.scalar(select(ScoreRevision.id))
        reference, _ = bind_bundle(db, storage, candidate, revision_id=revision_id)
        original = db.get(PracticeBundleRecord, reference.id)
        ids = {original.prepared_musicxml_object_id, original.artifact_object_id}
        db.execute(delete(ScoreRevisionPracticeBinding))
        operations = PracticeBundleRetention(
            config=StoredObjectRetirementSettings.model_validate(
                get_context().settings.model_dump()
            )
        ).retire_unowned(db, reference.id)
        db.commit()
    entered, release = Event(), Event()
    remove, lookup = storage.delete, retirement_execution._object

    def blocked_delete(key):
        entered.set()
        assert release.wait(15)
        return remove(key)

    def before_object(db, identity):
        entered.set()
        assert release.wait(15)
        return lookup(db, identity)

    monkeypatch.setattr(
        storage if worker_wins else retirement_execution,
        "delete" if worker_wins else "_object",
        blocked_delete if worker_wins else before_object,
    )
    pids = []

    def acquire():
        with sessions() as db:
            pids.append(db.scalar(text("SELECT pg_backend_pid()")))
            return bind_bundle(db, storage, candidate, revision_id=revision_id)

    with ThreadPoolExecutor(2) as pool:
        retiring = pool.submit(worker.execute_stored_object_retirement_task, None, operations[0])
        try:
            assert entered.wait(10)
            acquiring = pool.submit(acquire)
            if worker_wins:
                deadline = monotonic() + 10
                while not pids:
                    assert monotonic() < deadline
                assert_blocked(engine, pids[0])
                release.set()
            rebound, verified = acquiring.result(15)
            release.set()
            result = retiring.result(15)
        finally:
            release.set()
    assert result["status"] == ("completed" if worker_wins else "ignored")
    with sessions() as db:
        current = db.get(PracticeBundleRecord, rebound.id)
        new_ids = {current.prepared_musicxml_object_id, current.artifact_object_id}
        assert len(new_ids - ids) == int(worker_wins)
        assert verified.bundle_id == candidate.bundle_id
        assert storage.read_bytes(current.prepared_musicxml_object.object_key)
        assert storage.read_bytes(current.artifact_object.object_key)


@pytest.mark.parametrize("commit_reached_server", [False, True])
def test_deletion_fence_commit_uncertainty_precedes_any_physical_delete(
    retirement_postgres, monkeypatch, commit_reached_server
):
    from app.modules.media_storage.retirement import retain_for_reference

    engine, sessions, storage = retirement_postgres
    identity, key, uuid = seed(retirement_postgres)
    injected = []

    class UncertainFence(Session):
        def commit(self):
            fencing = any(
                isinstance(row, StoredObjectRetirement)
                and row.status == StoredObjectRetirementStatus.PROCESSING
                and row.deletion_fenced_at is not None
                for row in self.dirty
            )
            if fencing and not injected:
                injected.append(True)
                if commit_reached_server:
                    super().commit()
                raise ConnectionError("fence acknowledgement unavailable")
            super().commit()

    inject_worker(
        monkeypatch,
        worker,
        sessions=sessionmaker(engine, class_=UncertainFence, expire_on_commit=False),
    )
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "failed"
    assert injected and storage.read_bytes(key) == CONTENT
    with sessions() as db:
        assert db.get(StoredObject, identity) is not None
        operation = deliveries().retirement.get(db, uuid)
        assert (operation.deletion_fenced_at is not None) == commit_reached_server
        if commit_reached_server:
            with pytest.raises(ValueError, match="deletion"):
                retain_for_reference(db, identity)
            db.rollback()
        else:
            assert retain_for_reference(db, identity) is not None
            db.commit()


def test_fenced_reference_is_integrity_failure_without_reference_or_physical_deletion(
    retirement_postgres, monkeypatch
):
    from unittest.mock import Mock
    from sqlalchemy.exc import IntegrityError
    from app.modules.media_storage.retirement import retain_for_reference

    engine, sessions, storage = retirement_postgres
    identity, key, uuid = seed(retirement_postgres)
    with sessions() as db:
        operation = deliveries().retirement.get(db, uuid)
        operation.deletion_fenced_at = utc_now()
        fence = operation.deletion_fenced_at
        # Deliberate corruption bypasses normal reference acquisition to exercise fail-closed IO.
        db.get(User, 1).avatar_object_id = identity
        db.commit()
    with sessions() as db, pytest.raises(ValueError, match="deletion"):
        retain_for_reference(db, identity)
    delete = Mock(wraps=storage.delete)
    monkeypatch.setattr(storage, "delete", delete)
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "failed"
    delete.assert_not_called()
    assert storage.read_bytes(key) == CONTENT
    with sessions() as db:
        operation = deliveries().retirement.get(db, uuid)
        assert operation.status == StoredObjectRetirementStatus.FAILED
        assert operation.deletion_fenced_at == fence
        assert db.get(User, 1).avatar_object_id == identity
        assert db.get(StoredObject, identity) is not None
        operation.status = StoredObjectRetirementStatus.CANCELLED
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        db.delete(db.get(StoredObject, identity))
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()
        assert deliveries().retirement.get(db, uuid).deletion_fenced_at == fence
    delete.assert_not_called()


def test_retirement_retry_exhaustion_preserves_fence_and_physical_evidence(
    retirement_postgres, monkeypatch
):
    from unittest.mock import Mock
    from app.modules.media_storage.retirement import retain_for_reference, snapshot

    engine, sessions, storage = retirement_postgres
    identity, key, uuid = seed(retirement_postgres)
    monkeypatch.setattr(deliveries().retirement.config, "STORED_OBJECT_RETIREMENT_MAX_ATTEMPTS", 2)
    delete = Mock(side_effect=OSError("provider unavailable"))
    monkeypatch.setattr(storage, "delete", delete)
    with sessions() as db:
        facts = snapshot(deliveries().retirement.get(db, uuid))
    fence = None
    for attempt in [1, 2]:
        assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "failed"
        with sessions() as db:
            operation = deliveries().retirement.get(db, uuid)
            assert operation.status == StoredObjectRetirementStatus.FAILED
            assert operation.attempt_count == attempt
            assert operation.deletion_fenced_at is not None
            fence = fence or operation.deletion_fenced_at
            assert operation.deletion_fenced_at == fence
            assert snapshot(operation) == facts
            operation.next_attempt_at = utc_now()
            db.commit()
    assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "ignored"
    assert delete.call_count == 2 and storage.read_bytes(key) == CONTENT
    with sessions() as db:
        assert deliveries().retirement.recover_and_list_due(db) == []
        operation = deliveries().retirement.get(db, uuid)
        assert operation.status == StoredObjectRetirementStatus.FAILED
        assert operation.attempt_count == 2 and operation.deletion_fenced_at == fence
        assert snapshot(operation) == facts and db.get(StoredObject, identity) is not None
        with pytest.raises(ValueError, match="deletion"):
            retain_for_reference(db, identity)
