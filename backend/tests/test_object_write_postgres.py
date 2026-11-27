"""Independent PostgreSQL connections prove write/adoption/cleanup fences."""

from tests.support.uploads import complete_image_upload
from tests.support.uploads import settled_upload_session

from app.composition import storage_resources as _resource_wiring
from app.composition import media_resources as _media_wiring
from tests.support.media_writes import persist_prepared_bytes


from uuid import uuid4

from app.composition.storage_resources import storage_quota_service

from tests.support.practice_bundle import bind_bundle

from app.db.models import StoragePlanPolicy, UserStorageEntitlement

import asyncio
from datetime import timedelta
from threading import Event

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db.models import ObjectWriteIntent, StoredObject, Upload, User

from app.modules.media_storage.write_intents import prepare_write, lock_intent
from app.modules.media_storage.adoption import adopt_written_object
from app.modules.media_storage.write_cleanup import write_cleanup_delivery
from app.shared.time import utc_now
from app.worker.execution import object_write_cleanup as worker
from tests.test_stored_object_retirement_postgres import (
    retirement_postgres as retirement_postgres,
    assert_blocked,
)
from tests.test_object_write_intents import facts
from tests.support.images import image_bytes

pytest_plugins = ["tests.test_practice_bundle_postgres"]


def setup_worker(fixture, monkeypatch):
    engine, sessions, storage = fixture

    monkeypatch.setattr(worker, "SessionLocal", sessions)
    monkeypatch.setattr(worker, "object_storage", storage)
    return engine, sessions, storage


async def prepared(fixture, monkeypatch, *, written=True, cleanup=False):
    engine, sessions, storage = setup_worker(fixture, monkeypatch)

    def create():
        with Session(engine) as db:
            receipt = prepare_write(db, facts())
            db.commit()
            if written:
                persist_prepared_bytes(db, storage, receipt, b"bytes")
            if cleanup:
                row = lock_intent(db, receipt.intent_uuid)
                row.write_expires_at = utc_now() - timedelta(seconds=1)
                db.commit()
                write_cleanup_delivery.recover_and_list_due(db)
                db.commit()
            return receipt

    return await asyncio.to_thread(create)


@pytest.mark.asyncio
async def test_writer_put_lock_blocks_cleanup_and_prepared_is_durable(
    retirement_postgres, monkeypatch
):
    engine, sessions, storage = setup_worker(retirement_postgres, monkeypatch)
    receipt = await prepared(retirement_postgres, monkeypatch, written=False)
    entered, release = Event(), Event()
    put = storage.put_bytes
    pid = []

    def slow_put(**kwargs):
        entered.set()
        assert release.wait(15)
        return put(**kwargs)

    monkeypatch.setattr(storage, "put_bytes", slow_put)

    def writing():
        with Session(engine) as db:
            persist_prepared_bytes(db, storage, receipt, b"bytes")

    def cleaning():
        with Session(engine) as db:
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            row = lock_intent(db, receipt.intent_uuid)
            # Recovery observes the successful write after the blocking IO, then
            # expires the lease for deterministic cleanup without timing guesses.
            row.write_expires_at = utc_now() - timedelta(seconds=1)
            db.commit()
            write_cleanup_delivery.recover_and_list_due(db)
            db.commit()
        return worker.execute_object_write_cleanup_task(None, receipt.intent_uuid)

    task = asyncio.create_task(asyncio.to_thread(writing))
    cleaner = None
    try:
        assert await asyncio.to_thread(entered.wait, 10)
        with sessions() as observer:
            row = observer.scalar(select(ObjectWriteIntent))
            assert row.status == "PREPARED" and observer.scalar(select(StoredObject)) is None
        cleaner = asyncio.create_task(asyncio.to_thread(cleaning))
        async with asyncio.timeout(10):
            while not pid:
                await asyncio.sleep(0)
        assert_blocked(engine, pid[0])
        assert not cleaner.done()
    finally:
        release.set()
        await task
    assert (await cleaner)["status"] == "cleaned"
    assert not storage.exists(receipt.object_key)


@pytest.mark.asyncio
async def test_cleanup_delete_lock_blocks_new_generation(retirement_postgres, monkeypatch):
    engine, sessions, storage = setup_worker(retirement_postgres, monkeypatch)
    receipt = await prepared(retirement_postgres, monkeypatch, cleanup=True)
    entered, release = Event(), Event()
    delete = storage.delete

    def slow_delete(key):
        entered.set()
        assert release.wait(15)
        return delete(key)

    monkeypatch.setattr(storage, "delete", slow_delete)
    deleting = asyncio.create_task(
        asyncio.to_thread(worker.execute_object_write_cleanup_task, None, receipt.intent_uuid)
    )
    pid = []

    def writing():
        from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator

        def physical_session():
            db = Session(engine)
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            return db

        return ObjectWriteCoordinator(storage, physical_session).write_bytes(
            key=receipt.object_key, content=b"bytes"
        )

    new = None
    try:
        assert await asyncio.to_thread(entered.wait, 10)
        new = asyncio.create_task(asyncio.to_thread(writing))
        async with asyncio.timeout(10):
            while not pid:
                await asyncio.sleep(0)
        assert_blocked(engine, pid[0])
        assert not new.done()
    finally:
        release.set()
        assert (await deleting)["status"] == "cleaned"
    current = await new
    assert (
        current.write_token != receipt.write_token
        and storage.read_bytes(current.object_key) == b"bytes"
    )

    def check():
        with Session(engine) as db:
            with pytest.raises(ValueError, match="Stale"):
                adopt_written_object(db, receipt)
            db.rollback()
            row = adopt_written_object(db, current)
            db.add(
                Upload(
                    upload_session=settled_upload_session(user_id=1),
                    stored_object_id=row.id,
                    original_filename="current",
                    uploader_user_id=1,
                )
            )
            db.commit()

    await asyncio.to_thread(check)


@pytest.mark.asyncio
@pytest.mark.parametrize("adoption_wins", [False, True])
async def test_adoption_and_cleanup_have_one_safe_winner(
    retirement_postgres, monkeypatch, adoption_wins
):
    engine, sessions, storage = setup_worker(retirement_postgres, monkeypatch)
    receipt = await prepared(retirement_postgres, monkeypatch, cleanup=not adoption_wins)
    entered, release = Event(), Event()
    if adoption_wins:
        pid = []

        def adopt():
            with Session(engine) as db:
                obj = adopt_written_object(db, receipt)
                db.add(
                    Upload(
                        upload_session=settled_upload_session(user_id=1),
                        stored_object_id=obj.id,
                        original_filename="owned",
                        uploader_user_id=1,
                    )
                )
                entered.set()
                assert release.wait(15)
                db.commit()

        def cleanup():
            with Session(engine) as db:
                pid.append(db.scalar(text("SELECT pg_backend_pid()")))
                row = lock_intent(db, receipt.intent_uuid)
                assert row.status == "ADOPTED"
                db.commit()
                assert write_cleanup_delivery.recover_and_list_due(db) == []

        owner = asyncio.create_task(asyncio.to_thread(adopt))
        contender = None
        try:
            assert await asyncio.to_thread(entered.wait, 10)
            contender = asyncio.create_task(asyncio.to_thread(cleanup))
            async with asyncio.timeout(10):
                while not pid:
                    await asyncio.sleep(0)
            assert_blocked(engine, pid[0])
        finally:
            release.set()
            await owner
        await contender
    else:
        pid = []
        delete = storage.delete

        def held_delete(key):
            entered.set()
            assert release.wait(15)
            return delete(key)

        monkeypatch.setattr(storage, "delete", held_delete)
        deleting = asyncio.create_task(
            asyncio.to_thread(worker.execute_object_write_cleanup_task, None, receipt.intent_uuid)
        )

        def stale():
            with Session(engine) as db:
                pid.append(db.scalar(text("SELECT pg_backend_pid()")))
                with pytest.raises(ValueError, match="WRITTEN"):
                    adopt_written_object(db, receipt)
                db.rollback()

        loser = None
        try:
            assert await asyncio.to_thread(entered.wait, 10)
            loser = asyncio.create_task(asyncio.to_thread(stale))
            async with asyncio.timeout(10):
                while not pid:
                    await asyncio.sleep(0)
            assert_blocked(engine, pid[0])
            assert not loser.done()
        finally:
            release.set()
            assert (await deleting)["status"] == "cleaned"
        await loser
    with sessions() as db:
        owned = db.scalar(select(Upload))
        assert (owned is not None) == adoption_wins
        assert storage.exists(receipt.object_key) == adoption_wins


@pytest.mark.asyncio
async def test_equal_upload_bytes_have_distinct_command_objects_and_both_commit(
    retirement_postgres, monkeypatch
):
    from fastapi import UploadFile
    from app.modules.uploads.service import UploadService
    import io
    from tests.test_score_revision_services import Session

    engine, sessions, storage = setup_worker(retirement_postgres, monkeypatch)
    from app.db.models import StorageUsageAccount, StorageUsageCounter
    from app.modules.storage_governance.usage.domain import StorageUsageCategory

    with Session(engine) as db:
        if db.get(StoragePlanPolicy, "FREE") is None:
            db.add(StoragePlanPolicy(plan_code="FREE", default_limit_bytes=1048576))
            db.flush()
        db.add(UserStorageEntitlement(user_id=1, plan_code="FREE"))
        db.add(
            StorageUsageAccount(
                user_id=1,
                used_bytes=0,
            )
        )
        db.add(StorageUsageCounter(user_id=1, category=StorageUsageCategory.UPLOAD, used_bytes=0))
        db.commit()

    def upload(name):
        with Session(engine, expire_on_commit=False) as db:
            user = db.get(User, 1)
            return complete_image_upload(
                UploadService(
                    quota=_resource_wiring.storage_quota_service,
                    usage=_resource_wiring.storage_usage_service,
                    uploads=_resource_wiring.build_upload_session_service(storage),
                ),
                db,
                user,
                UploadFile(filename=name, file=io.BytesIO(image_bytes())),
                client_request_id=uuid4().hex,
            )

    one, two = await asyncio.gather(
        asyncio.to_thread(upload, "one.png"), asyncio.to_thread(upload, "two.png")
    )
    assert one.upload_id != two.upload_id
    with sessions() as db:
        uploads = list(db.scalars(select(Upload)))
        objects = list(db.scalars(select(StoredObject)))
        intents = list(db.scalars(select(ObjectWriteIntent)))
        assert len(uploads) == len(objects) == len(intents) == 2
        assert len({row.stored_object_id for row in uploads}) == 2
        assert (
            intents[0].status == "ADOPTED"
            and storage.read_bytes(objects[0].object_key) == image_bytes()
        )


@pytest.mark.asyncio
async def test_bundle_creating_gc_during_put_leaves_only_cleanup_owned_bytes(
    retirement_postgres, postgres_bundle, monkeypatch
):
    from app.db.models import PracticeBundleRecord, ScoreRevisionPracticeBinding
    from app.core.exceptions import ValidationException
    from app.modules.practice.bundle.retention import practice_bundle_retention
    from tests.support.take_fixtures import Session

    engine, sessions, storage = setup_worker(retirement_postgres, monkeypatch)
    _, repository, bundle, _ = postgres_bundle
    entered, release = Event(), Event()
    put = storage.put_bytes
    first = True

    def slow_put(**kwargs):
        nonlocal first
        if first:
            first = False
            entered.set()
            assert release.wait(15)
        return put(**kwargs)

    monkeypatch.setattr(storage, "put_bytes", slow_put)

    def construct():
        with Session(engine, expire_on_commit=False) as db:
            with pytest.raises(ValidationException) as error:
                bind_bundle(db, storage, bundle, revision_id=repository.test_revision_id)
            assert error.value.details["reason"] == "creation_lease_lost"
            db.rollback()

    creating = asyncio.create_task(asyncio.to_thread(construct))
    try:
        assert await asyncio.to_thread(entered.wait, 10)
        with sessions() as db:
            row = db.scalar(select(PracticeBundleRecord))
            assert row.prepared_musicxml_object_id is None and row.artifact_object_id is None
            assert db.scalar(select(StoredObject)) is None
            row.creation_expires_at = utc_now() - timedelta(seconds=1)
            db.commit()
            assert practice_bundle_retention.recover_stale_creating(db) == []
            db.commit()
    finally:
        release.set()
        await creating
    with sessions() as db:
        assert db.scalar(select(PracticeBundleRecord)) is None
        assert db.scalar(select(ScoreRevisionPracticeBinding)) is None
        assert db.scalar(select(StoredObject)) is None
        rows = list(db.scalars(select(ObjectWriteIntent)))
        assert len(rows) == 2 and all(row.status == "WRITTEN" for row in rows)
        for row in rows:
            row.write_expires_at = utc_now() - timedelta(seconds=1)
        db.commit()
        due = write_cleanup_delivery.recover_and_list_due(db)
        db.commit()
    for uuid in due:
        assert (await asyncio.to_thread(worker.execute_object_write_cleanup_task, None, uuid))[
            "status"
        ] == "cleaned"
    assert not storage.objects


@pytest.mark.asyncio
async def test_retirement_of_reused_authority_forces_fresh_write(retirement_postgres, monkeypatch):
    from app.modules.media_storage.retirement import retire_after_release
    from app.modules.media_storage.persistence import object_from_bytes
    from app.worker.execution import stored_object_retirement

    engine, sessions, storage = setup_worker(retirement_postgres, monkeypatch)

    def scenario():
        with Session(engine) as db:
            obj = object_from_bytes(
                object_key=facts().object_key,
                content=b"bytes",
                content_type="application/octet-stream",
            )
            db.add(obj)
            db.flush()
            uuid = retire_after_release(db, obj.id)[0]
            db.commit()
            storage.put_bytes(key=facts().object_key, content=b"bytes")
            receipt = _resource_wiring.build_object_write_coordinator(storage).write_bytes(
                key=facts().object_key, content=b"bytes"
            )
            assert lock_intent(db, receipt.intent_uuid).status == "ADOPTED"
            db.rollback()
        assert (
            stored_object_retirement.execute_stored_object_retirement_task(None, uuid)["status"]
            == "completed"
        )
        with Session(engine) as db:
            with pytest.raises(ValueError, match="WRITTEN"):
                adopt_written_object(db, receipt)
            db.rollback()
            assert db.scalar(select(StoredObject)) is None
            current = _resource_wiring.build_object_write_coordinator(storage).write_bytes(
                key=receipt.object_key, content=b"bytes"
            )
            assert current.write_token != receipt.write_token
            obj = adopt_written_object(db, current)
            db.add(
                Upload(
                    upload_session=settled_upload_session(user_id=1),
                    stored_object_id=obj.id,
                    original_filename="fresh",
                    uploader_user_id=1,
                )
            )
            db.commit()
            assert storage.read_bytes(current.object_key) == b"bytes"

    await asyncio.to_thread(scenario)


@pytest.mark.asyncio
async def test_revision_rechecks_head_after_prewrite_commit(
    retirement_postgres, postgres_bundle, monkeypatch
):
    from app.db.models import (
        Score,
        ScoreRevision,
        ScoreRevisionSource,
        StorageUsageAccount,
        StorageUsageCounter,
    )
    from app.modules.storage_governance.usage.domain import StorageUsageCategory
    from app.modules.revisions.service import RevisionService
    from app.modules.revisions.schemas import RevisionCreateRequest
    from app.core.exceptions import ConflictException
    from tests.support.take_fixtures import Session
    from tests.test_score_revision_services import MUSICXML_2

    engine, sessions, storage = setup_worker(retirement_postgres, monkeypatch)
    _, repository, _, _ = postgres_bundle
    with Session(engine) as db:
        if db.get(StoragePlanPolicy, "FREE") is None:
            db.add(StoragePlanPolicy(plan_code="FREE", default_limit_bytes=1048576))
            db.flush()
        db.add(UserStorageEntitlement(user_id=1, plan_code="FREE"))
        db.add(
            StorageUsageAccount(
                user_id=1,
                used_bytes=0,
            )
        )
        db.add(StorageUsageCounter(user_id=1, category=StorageUsageCategory.SOURCE, used_bytes=0))
        db.commit()
    put = storage.put_bytes

    def concurrent_head(**kwargs):
        with Session(engine) as other:
            score = other.scalar(select(Score).with_for_update())
            revision = ScoreRevision(
                revision_uuid="other-editor",
                score_id=score.id,
                revision_number=2,
                content_hash="d" * 64,
                origin="EDIT",
                created_by_user_id=1,
            )
            other.add(revision)
            other.flush()
            score.head_revision_id = revision.id
            other.commit()
        return put(**kwargs)

    monkeypatch.setattr(storage, "put_bytes", concurrent_head)

    def edit():
        with Session(engine, expire_on_commit=False) as db:
            with pytest.raises(ConflictException):
                RevisionService(
                    quota=_resource_wiring.storage_quota_service,
                    revision_writer=_media_wiring.build_revision_writer(),
                    writes=_resource_wiring.build_object_write_coordinator(storage),
                ).create(
                    db,
                    repository.test_score_uuid,
                    1,
                    RevisionCreateRequest(
                        content=MUSICXML_2,
                        expected_head_revision_id=repository.test_revision_uuid,
                    ),
                )
            assert db.scalar(select(Score)).head_revision_id != repository.test_revision_id
            assert db.scalar(select(ScoreRevisionSource)) is None
            assert db.scalar(select(StoredObject)) is None
            assert db.scalar(select(ObjectWriteIntent)).status == "WRITTEN"
            assert storage_quota_service.snapshot_user(db, 1).reserved_bytes == 0

    await asyncio.to_thread(edit)


def test_import_artifact_replacement_acquires_intent_before_released_object(retirement_postgres):
    from app.db.models import ImportJob, ImportArtifact
    from app.modules.import_jobs.domain import ImportArtifactKind
    from app.modules.import_jobs.domain import ImportJobState
    from app.modules.import_jobs.execution_recorder import ImportExecutionRecorder
    from app.modules.import_jobs.requested_options import encode_requested_options
    from tests.support.import_execution import processing_lease
    from tests.support.storage_state import provision_storage_users
    from app.composition.storage_resources import storage_usage_service
    from app.modules.storage_governance.usage.domain import StorageUsageCategory
    from app.modules.media_storage.references import stored_object_has_semantic_references
    from app.modules.media_storage.write_intents import lock_intent
    from tests.test_stored_object_retirement_postgres import assert_blocked
    from sqlalchemy import text

    engine, sessions, storage = retirement_postgres
    with sessions() as db:
        provision_storage_users(db)
        job = ImportJob(
            job_uuid="replace",
            user_id=1,
            state=ImportJobState.PROCESSING,
            processing_started_at=utc_now(),
            requested_options=encode_requested_options(None),
        )
        db.add(job)
        db.commit()
        receipt = _resource_wiring.build_object_write_coordinator(storage).write_bytes(
            key="artifact/replacement.xml", content=b"<score/>", content_type="application/xml"
        )
        stored = adopt_written_object(db, receipt)
        db.add(
            ImportArtifact(
                job_id=job.id,
                kind=ImportArtifactKind.REVIEW_MUSICXML,
                stored_object_id=stored.id,
                filename="score.xml",
            )
        )
        storage_usage_service.record_allocation(
            db,
            user_id=1,
            category=StorageUsageCategory.TEMP_IMPORT,
            bytes_count=8,
            reason="fixture",
        )
        db.commit()
        identity = stored.id
        lease = processing_lease(db, job)
    from concurrent.futures import ThreadPoolExecutor

    entered = Event()
    pids = []

    def replace():
        with sessions() as db:
            pids.append(db.scalar(text("SELECT pg_backend_pid()")))
            entered.set()
            ImportExecutionRecorder(usage=_resource_wiring.storage_usage_service).replace_artifacts(
                db,
                lease,
                ImportArtifactKind.REVIEW_MUSICXML,
                [
                    {
                        "write_intent_uuid": receipt.intent_uuid,
                        "write_token": receipt.write_token,
                        "filename": "score.xml",
                        "page_number": None,
                    }
                ],
            )

    with sessions() as predecessor, ThreadPoolExecutor(1) as pool:
        lock_intent(predecessor, receipt.intent_uuid)
        pending = pool.submit(replace)
        assert entered.wait(10)
        try:
            assert_blocked(engine, pids[0])
            # Another lifecycle participant holding Intent may acquire StoredObject.
            # A replacement must not hold the old object while waiting for that Intent.
            predecessor.scalar(
                select(StoredObject).where(StoredObject.id == identity).with_for_update(nowait=True)
            )
        finally:
            predecessor.commit()
        pending.result(10)
    with sessions() as db:
        assert stored_object_has_semantic_references(db, identity)
        assert db.scalar(select(ImportArtifact)).stored_object_id == identity
        assert storage.read_bytes(receipt.object_key) == b"<score/>"
