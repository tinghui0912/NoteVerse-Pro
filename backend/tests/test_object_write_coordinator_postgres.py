"""Independent durable writes, bounded batch transactions and atomic adoption."""

from tests.support.uploads import settled_upload_session

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from threading import Event
from time import monotonic
from unittest.mock import Mock

import pytest
from sqlalchemy import select, event, text, func
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import ObjectWriteIntent, StoredObject, Upload, User
from app.modules.media_storage.domain import ObjectWriteIntentStatus as Status
from app.modules.media_storage.write_contracts import ObjectWriteItem
from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator
from app.modules.media_storage.adoption import adopt_written_object, adopt_written_objects
from app.modules.media_storage.write_cleanup import write_cleanup_delivery, clean_write_attempt
from tests.support.object_storage import InMemoryObjectStorage
from app.storage.base import ObjectStorageOperationFailedError, ObjectStorageUnavailableError


@pytest.fixture
def writes(postgres_engine):
    sessions = sessionmaker(postgres_engine, expire_on_commit=False)
    with sessions.begin() as db:
        db.add_all(
            [User(id=i, email=f"owner{i}@example.test", password_hash="hash") for i in (1, 2)]
        )
    storage = InMemoryObjectStorage()
    return sessions, storage, ObjectWriteCoordinator(storage, sessions)


def test_write_does_not_commit_flush_or_rollback_caller(writes):
    sessions, storage, coordinator = writes
    with sessions() as caller:
        user = caller.get(User, 1)
        user.display_name = "uncommitted"
        caller.flush()
        commits = Mock()
        event.listen(caller, "after_commit", commits)
        receipt = coordinator.write_bytes(key="write/object", content=b"data")
        assert caller.in_transaction()
        assert user.display_name == "uncommitted"
        commits.assert_not_called()
        caller.rollback()
    with sessions() as observer:
        assert observer.get(User, 1).display_name != "uncommitted"
        assert observer.scalar(select(ObjectWriteIntent)).status == Status.WRITTEN
        assert observer.scalar(select(StoredObject)) is None
    assert storage.read_bytes(receipt.object_key) == b"data"


def test_batch_preparation_is_atomic_and_uses_two_outer_commits(writes):
    sessions, storage, coordinator = writes
    commits = []
    engine = sessions.kw["bind"]

    def committed(connection):
        commits.append(connection)

    event.listen(engine, "commit", committed)
    try:
        receipts = coordinator.write_batch(
            [ObjectWriteItem(f"batch/{i}", b"bytes") for i in range(6)]
        )
    finally:
        event.remove(engine, "commit", committed)
    assert len(commits) == 2 and len(receipts) == 6
    with sessions() as db:
        assert {row.status for row in db.scalars(select(ObjectWriteIntent))} == {Status.WRITTEN}
    storage.put_bytes = Mock(wraps=storage.put_bytes)
    with pytest.raises(ValueError, match="conflicting"):
        coordinator.write_batch(
            [ObjectWriteItem("batch/new", b"new"), ObjectWriteItem("batch/0", b"conflict")]
        )
    storage.put_bytes.assert_not_called()
    with sessions() as db:
        assert (
            db.scalar(select(ObjectWriteIntent).where(ObjectWriteIntent.object_key == "batch/new"))
            is None
        )


def test_partial_batch_failure_keeps_every_key_cleanup_owned(writes):
    sessions, storage, coordinator = writes
    put = storage.put_bytes

    def failing(**kwargs):
        if kwargs["key"] == "batch/b":
            raise ObjectStorageOperationFailedError("provider rejected bytes")
        return put(**kwargs)

    storage.put_bytes = failing
    with pytest.raises(ObjectStorageOperationFailedError):
        coordinator.write_batch([ObjectWriteItem("batch/" + suffix, b"bytes") for suffix in "abc"])
    with sessions() as db:
        rows = list(db.scalars(select(ObjectWriteIntent)))
        assert len(rows) == 3 and {row.status for row in rows} == {Status.CLEANUP_PENDING}
        assert db.scalar(select(StoredObject)) is None
        identities = write_cleanup_delivery.recover_and_list_due(db)
        db.commit()
    for identity in identities:
        with sessions.begin() as db:
            attempt = write_cleanup_delivery.claim(db, identity)
        with sessions.begin() as db:
            assert clean_write_attempt(db, storage, attempt) == "cleaned"
    assert storage.objects == {}


def test_copy_verifies_exact_bytes_and_uses_atomic_adoption(writes):
    sessions, storage, coordinator = writes
    data = b"verified direct upload"
    storage.put_bytes(key="staging/input", content=data, content_type="audio/webm")
    receipt = coordinator.copy_object(
        "staging/input",
        key="final/output",
        byte_size=len(data),
        sha256=sha256(data).hexdigest(),
        content_type="audio/webm",
    )
    with sessions() as db:
        obj = adopt_written_object(db, receipt)
        db.add(
            Upload(
                upload_session=settled_upload_session(user_id=1),
                stored_object_id=obj.id,
                uploader_user_id=1,
                original_filename="recording.webm",
            )
        )
        db.rollback()
    with sessions() as db:
        assert db.scalar(select(StoredObject)) is None
        assert db.scalar(select(ObjectWriteIntent)).status == Status.WRITTEN
        obj = adopt_written_object(db, receipt)
        db.add(
            Upload(
                upload_session=settled_upload_session(user_id=1),
                stored_object_id=obj.id,
                uploader_user_id=1,
                original_filename="recording.webm",
            )
        )
        db.commit()
    assert storage.read_bytes("final/output") == data


def test_copy_rejects_mutated_source_and_leaves_target_cleanup_owned(writes):
    sessions, storage, coordinator = writes
    storage.put_bytes(key="staging/input", content=b"data", content_type="audio/webm")

    def changing_copy(source, target):
        storage.put_bytes(key=target, content=b"evil", content_type="audio/webm")

    storage.copy = changing_copy
    with pytest.raises(ValueError, match="Copied object"):
        coordinator.copy_object(
            "staging/input",
            key="final/output",
            byte_size=4,
            sha256=sha256(b"data").hexdigest(),
            content_type="audio/webm",
        )
    with sessions() as db:
        assert db.scalar(select(ObjectWriteIntent)).status == Status.CLEANUP_PENDING
        assert db.scalar(select(StoredObject)) is None


def test_concurrent_adoption_waits_on_intent_and_preserves_two_owners(writes):
    sessions, storage, coordinator = writes
    receipt = coordinator.write_bytes(key="shared/object", content=b"data")
    held, release, waiting = Event(), Event(), Event()
    pids = {}

    def adopt(owner):
        with sessions() as db:
            pids[owner] = db.scalar(text("SELECT pg_backend_pid()"))
            if owner == 2:
                waiting.set()
            obj = adopt_written_object(db, receipt)
            db.add(
                Upload(
                    upload_session=settled_upload_session(user_id=owner),
                    stored_object_id=obj.id,
                    uploader_user_id=owner,
                    original_filename="data",
                )
            )
            db.flush()
            if owner == 1:
                held.set()
                assert release.wait(10)
            db.commit()
            return obj.id

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(adopt, 1)
        try:
            assert held.wait(10)
            second = pool.submit(adopt, 2)
            assert waiting.wait(10)
            deadline = monotonic() + 5
            with sessions() as observer:
                while True:
                    blockers = observer.scalar(
                        text("SELECT pg_blocking_pids(:pid)"), {"pid": pids[2]}
                    )
                    if pids[1] in blockers:
                        break
                    assert monotonic() < deadline
        finally:
            release.set()
        assert first.result(10) == second.result(10)
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(StoredObject)) == 1
        assert db.scalar(select(func.count()).select_from(Upload)) == 2


def test_batch_adoption_preserves_receipt_order_and_rolls_back_as_one_unit(writes):
    sessions, storage, coordinator = writes
    receipts = coordinator.write_batch(
        [ObjectWriteItem("batch/b", b"b"), ObjectWriteItem("batch/a", b"a")]
    )
    with sessions() as db:
        objects = adopt_written_objects(db, receipts)
        assert [obj.object_key for obj in objects] == ["batch/b", "batch/a"]
        db.rollback()
    with sessions() as db:
        assert db.scalar(select(StoredObject)) is None
        assert {row.status for row in db.scalars(select(ObjectWriteIntent))} == {Status.WRITTEN}


def test_uncertain_written_commit_retains_durable_cleanup_responsibility(writes):
    sessions, storage, _ = writes

    class UncertainCommitSession(Session):
        commits = 0

        def commit(self):
            super().commit()
            UncertainCommitSession.commits += 1
            if self.commits == 2:
                raise RuntimeError("Commit acknowledgement unavailable")

    uncertain = sessionmaker(
        sessions.kw["bind"], class_=UncertainCommitSession, expire_on_commit=False
    )
    coordinator = ObjectWriteCoordinator(storage, uncertain)
    with pytest.raises(RuntimeError, match="acknowledgement"):
        coordinator.write_bytes(key="uncertain/output", content=b"bytes")
    with sessions() as db:
        row = db.scalar(select(ObjectWriteIntent))
        assert row.status == Status.CLEANUP_PENDING
        assert storage.exists(row.object_key)
        assert db.scalar(select(StoredObject)) is None
        identity = row.intent_uuid
    with sessions.begin() as db:
        attempt = write_cleanup_delivery.claim(db, identity)
    with sessions.begin() as db:
        assert clean_write_attempt(db, storage, attempt) == "cleaned"
    assert not storage.exists("uncertain/output")


def test_physical_failure_does_not_rollback_pending_business_changes(writes):
    sessions, storage, coordinator = writes
    storage.put_bytes = Mock(side_effect=OSError("Provider unavailable"))
    with sessions() as caller:
        user = caller.get(User, 1)
        user.display_name = "pending mutation"
        caller.flush()
        with pytest.raises(OSError):
            coordinator.write_bytes(key="failing/output", content=b"bytes")
        assert caller.in_transaction() and user.display_name == "pending mutation"
        with sessions() as observer:
            assert observer.get(User, 1).display_name != "pending mutation"
        caller.commit()
    with sessions() as observer:
        assert observer.get(User, 1).display_name == "pending mutation"
        assert observer.scalar(select(ObjectWriteIntent)).status == Status.WRITE_UNKNOWN


@pytest.mark.parametrize("command", ["bytes", "batch", "copy"])
def test_provider_io_has_no_open_coordinator_session_or_checked_out_connection(writes, command):
    sessions, storage, _ = writes
    engine = sessions.kw["bind"]
    storage.put_bytes(key="source", content=b"bytes", content_type="application/octet-stream")
    active = set()

    class ObservedSession(Session):
        def __enter__(self):
            active.add(id(self))
            return super().__enter__()

        def close(self):
            super().close()
            active.discard(id(self))

    observed = sessionmaker(engine, class_=ObservedSession, expire_on_commit=False)
    coordinator = ObjectWriteCoordinator(storage, observed)
    for name in ("put_bytes", "copy", "object_metadata", "iter_bytes"):
        original = getattr(storage, name)

        def guarded(*args, _original=original, **kwargs):
            assert not active and engine.pool.checkedout() == 0
            return _original(*args, **kwargs)

        setattr(storage, name, guarded)
    if command == "bytes":
        coordinator.write_bytes(key="result", content=b"bytes")
    elif command == "batch":
        coordinator.write_batch(
            [ObjectWriteItem("batch/a", b"a"), ObjectWriteItem("batch/b", b"b")]
        )
    else:
        coordinator.copy_object(
            "source",
            key="result",
            byte_size=5,
            sha256=sha256(b"bytes").hexdigest(),
            content_type="application/octet-stream",
        )


def test_unknown_provider_mutation_excludes_cleanup_and_replacement_generation(writes):
    sessions, storage, coordinator = writes

    def unknown(**kwargs):
        raise ObjectStorageUnavailableError("Provider outcome unknown")

    storage.put_bytes = unknown
    with pytest.raises(ObjectStorageUnavailableError):
        coordinator.write_bytes(key="unknown", content=b"bytes")
    with sessions() as db:
        row = db.scalar(select(ObjectWriteIntent))
        assert row.status == Status.WRITE_UNKNOWN
        generation = row.write_token
        assert write_cleanup_delivery.recover_and_list_due(db) == []
        db.commit()
    with pytest.raises(ValueError, match="owns"):
        coordinator.write_bytes(key="unknown", content=b"bytes")
    with sessions() as db:
        assert db.scalar(select(ObjectWriteIntent)).write_token == generation
