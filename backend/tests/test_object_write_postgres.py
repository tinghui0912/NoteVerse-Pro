"""Independent PostgreSQL connections prove write/adoption/cleanup fences."""

import asyncio
from datetime import timedelta
from threading import Event

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db.models import ObjectWriteIntent, StoredObject, Upload, User
from app.modules.storage_objects.writes import (
    write_object,
    prepare_write,
    perform_write,
    adopt_written_object,
    lock_intent,
    write_cleanup_delivery,
)
from app.utils.timezone import utc_now_naive
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
            if written:
                perform_write(db, storage, receipt, b"bytes")
            if cleanup:
                row = lock_intent(db, receipt.intent_uuid)
                row.write_expires_at = utc_now_naive() - timedelta(seconds=1)
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
            perform_write(db, storage, receipt, b"bytes")

    def cleaning():
        with Session(engine) as db:
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            row = lock_intent(db, receipt.intent_uuid)
            # Recovery observes the successful write after the blocking IO, then
            # expires the lease for deterministic cleanup without timing guesses.
            row.write_expires_at = utc_now_naive() - timedelta(seconds=1)
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
        with Session(engine) as db:
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            return write_object(db, storage, key=receipt.object_key, content=b"bytes")

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
            db.add(Upload(stored_object_id=row.id, original_filename="current", uploader_user_id=1))
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
                    Upload(stored_object_id=obj.id, original_filename="owned", uploader_user_id=1)
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
async def test_two_equal_files_uploads_share_key_and_both_commit(retirement_postgres, monkeypatch):
    from fastapi import UploadFile
    from app.modules.uploads.service import UploadService
    import io
    from tests.test_score_revision_services import Session

    engine, sessions, storage = setup_worker(retirement_postgres, monkeypatch)
    from app.db.models import StorageUsageAccount, StorageUsageCounter, StorageUsageCategory

    with Session(engine) as db:
        db.add(
            StorageUsageAccount(
                user_id=1,
                plan_code="FREE",
                quota_limit_bytes=1048576,
                used_bytes=0,
                reserved_bytes=0,
            )
        )
        db.add(
            StorageUsageCounter(
                user_id=1, category=StorageUsageCategory.UPLOAD, used_bytes=0, reserved_bytes=0
            )
        )
        db.commit()

    def upload(name):
        with Session(engine, expire_on_commit=False) as db:
            user = db.get(User, 1)
            return UploadService(storage=storage).create_upload(
                db,
                user,
                UploadFile(filename=name, file=io.BytesIO(image_bytes())),
            )

    one, two = await asyncio.gather(
        asyncio.to_thread(upload, "one.png"), asyncio.to_thread(upload, "two.png")
    )
    assert one.upload_id != two.upload_id
    with sessions() as db:
        uploads = list(db.scalars(select(Upload)))
        objects = list(db.scalars(select(StoredObject)))
        intents = list(db.scalars(select(ObjectWriteIntent)))
        assert len(uploads) == 2 and len(objects) == len(intents) == 1
        assert len({row.stored_object_id for row in uploads}) == 1
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
    from tests.test_performance_takes import Session

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
                repository.get_or_create(db, bundle, revision_id=repository.test_revision_id)
            assert error.value.details["reason"] == "creation_lease_lost"
            db.rollback()

    creating = asyncio.create_task(asyncio.to_thread(construct))
    try:
        assert await asyncio.to_thread(entered.wait, 10)
        with sessions() as db:
            row = db.scalar(select(PracticeBundleRecord))
            assert row.prepared_musicxml_object_id is None and row.artifact_object_id is None
            assert db.scalar(select(StoredObject)) is None
            row.creation_expires_at = utc_now_naive() - timedelta(seconds=1)
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
            row.write_expires_at = utc_now_naive() - timedelta(seconds=1)
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
    from app.modules.storage_objects.retirement import retire_after_release
    from app.modules.storage_objects.persistence import object_from_bytes
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
            receipt = write_object(db, storage, key=facts().object_key, content=b"bytes")
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
            current = write_object(db, storage, key=receipt.object_key, content=b"bytes")
            assert current.write_token != receipt.write_token
            obj = adopt_written_object(db, current)
            db.add(Upload(stored_object_id=obj.id, original_filename="fresh", uploader_user_id=1))
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
        StorageUsageCategory,
    )
    from app.modules.revisions.service import RevisionService
    from app.modules.revisions.schemas import RevisionCreateRequest
    from app.core.exceptions import ConflictException
    from tests.test_performance_takes import Session
    from tests.test_score_revision_services import MUSICXML_2

    engine, sessions, storage = setup_worker(retirement_postgres, monkeypatch)
    _, repository, _, _ = postgres_bundle
    with Session(engine) as db:
        db.add(
            StorageUsageAccount(
                user_id=1,
                plan_code="FREE",
                quota_limit_bytes=1048576,
                used_bytes=0,
                reserved_bytes=0,
            )
        )
        db.add(
            StorageUsageCounter(
                user_id=1, category=StorageUsageCategory.SOURCE, used_bytes=0, reserved_bytes=0
            )
        )
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
                RevisionService(storage=storage).create(
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
            assert db.get(StorageUsageAccount, 1).reserved_bytes == 0

    await asyncio.to_thread(edit)
